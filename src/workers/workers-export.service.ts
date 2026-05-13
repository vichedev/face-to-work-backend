import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import * as archiver from 'archiver';
import { Writable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { User } from '../users/user.entity';
import { Attendance } from '../attendance/attendance.entity';
import { Activity } from '../activities/activity.entity';
import { Justification } from '../justifications/justification.entity';

function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtDT(d: Date) { return `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }

/**
 * Empaqueta TODO el historial de un trabajador (marcajes + actividades +
 * justificaciones + fotos) en un ZIP que el admin descarga. Útil para
 * auditoría externa, baja de personal, o respaldo individual.
 */
@Injectable()
export class WorkersExportService {
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Attendance) private readonly attRepo: Repository<Attendance>,
    @InjectRepository(Activity) private readonly actRepo: Repository<Activity>,
    @InjectRepository(Justification) private readonly justRepo: Repository<Justification>,
  ) {}

  /** Streamea un ZIP completo al writable proporcionado. */
  async exportToStream(workerId: string, out: Writable, opts: { from?: string; to?: string } = {}) {
    const worker = await this.usersRepo.findOne({ where: { id: workerId } });
    if (!worker) throw new NotFoundException('Trabajador no encontrado');

    const fromDate = opts.from ? new Date(opts.from + 'T00:00:00') : new Date(worker.createdAt);
    const toDate = opts.to ? new Date(opts.to + 'T23:59:59') : new Date();

    const [marks, acts, justs] = await Promise.all([
      this.attRepo.find({ where: { workerId, createdAt: Between(fromDate, toDate) }, order: { createdAt: 'ASC' } }),
      this.actRepo.find({ where: { workerId, startedAt: Between(fromDate, toDate) }, order: { startedAt: 'ASC' } }),
      this.justRepo.find({ where: { workerId }, order: { createdAt: 'ASC' } }),
    ]);

    const zip = (archiver as any)('zip', { zlib: { level: 6 } });
    zip.pipe(out);

    // README con resumen
    const readme = [
      `Reporte de trabajador — ${worker.name}`,
      ``,
      `Código:     ${worker.code || '—'}`,
      `Correo:     ${worker.email}`,
      `Cargo:      ${worker.position || '—'}`,
      `Departamento: ${worker.department || '—'}`,
      `Activo:     ${worker.active ? 'sí' : 'no'}`,
      `Inscripción: ${fmtDT(new Date(worker.createdAt))}`,
      ``,
      `Rango exportado: ${fmtDate(fromDate)}  →  ${fmtDate(toDate)}`,
      ``,
      `Resumen`,
      `  · Marcajes:        ${marks.length}`,
      `  · Actividades:     ${acts.length}`,
      `  · Justificaciones: ${justs.length}`,
      ``,
      `Generado: ${fmtDT(new Date())}`,
    ].join('\n');
    zip.append(readme, { name: 'README.txt' });

    // CSV de marcajes
    const attLines = [
      'fecha;hora;tipo;estado_jornada;tardanza_min;hora_extra_min;match_facial;confianza_%;dentro_oficina;distancia_m;latitud;longitud;ubicacion;greeting;photo_filename',
      ...marks.map((m) => {
        const d = new Date(m.createdAt);
        const photo = m.photoUrl ? path.basename(m.photoUrl.split('?')[0]) : '';
        return [
          fmtDate(d), `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
          m.type, m.scheduleStatus || '', m.scheduleStatus === 'late' ? m.scheduleMinutes : 0,
          m.scheduleStatus === 'overtime' ? m.scheduleMinutes : 0,
          m.matchStatus || '', Math.round(m.confidence || 0),
          m.insideOffice ? 'si' : 'no', m.distanceFromOfficeMeters ?? '',
          m.latitude ?? '', m.longitude ?? '',
          (m.locationLabel || '').replace(/;/g, ','),
          (m.greeting || '').replace(/;/g, ','),
          photo,
        ].join(';');
      }),
    ].join('\n');
    zip.append('﻿sep=;\n' + attLines, { name: 'marcajes.csv' });

    // CSV de actividades
    const actLines = [
      'fecha_inicio;hora_inicio;fecha_fin;hora_fin;titulo;descripcion;duracion_min;status;completion_note;lat_inicio;lng_inicio;lat_fin;lng_fin;photo_inicio;photo_fin',
      ...acts.map((a) => {
        const s = new Date(a.startedAt);
        const e = a.endedAt ? new Date(a.endedAt) : null;
        return [
          fmtDate(s), `${pad2(s.getHours())}:${pad2(s.getMinutes())}`,
          e ? fmtDate(e) : '', e ? `${pad2(e.getHours())}:${pad2(e.getMinutes())}` : '',
          (a.title || '').replace(/;/g, ','),
          (a.description || '').replace(/;/g, ',').replace(/\n/g, ' '),
          a.durationMinutes || 0, a.status,
          (a.completionNote || '').replace(/;/g, ',').replace(/\n/g, ' '),
          a.startLatitude ?? '', a.startLongitude ?? '',
          a.endLatitude ?? '', a.endLongitude ?? '',
          a.startPhotoUrl ? path.basename(a.startPhotoUrl) : '',
          a.endPhotoUrl ? path.basename(a.endPhotoUrl) : '',
        ].join(';');
      }),
    ].join('\n');
    zip.append('﻿sep=;\n' + actLines, { name: 'actividades.csv' });

    // CSV de justificaciones
    const justLines = [
      'fecha_envio;fecha_desde;fecha_hasta;tipo;razon;status;admin_note;decidida',
      ...justs.map((j) => [
        fmtDT(new Date(j.createdAt)),
        j.dateFrom, j.dateTo, j.type,
        (j.reason || '').replace(/;/g, ',').replace(/\n/g, ' '),
        j.status,
        (j.adminNote || '').replace(/;/g, ',').replace(/\n/g, ' '),
        j.decidedAt ? fmtDT(new Date(j.decidedAt)) : '',
      ].join(';')),
    ].join('\n');
    zip.append('﻿sep=;\n' + justLines, { name: 'justificaciones.csv' });

    // Fotos (carpeta /fotos/)
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const addFile = (filename: string, alias?: string) => {
      if (!filename) return;
      const cleanName = path.basename(String(filename).split('?')[0]);
      if (!cleanName || cleanName.includes('..')) return;
      const full = path.join(uploadsDir, cleanName);
      if (fs.existsSync(full)) {
        zip.file(full, { name: `fotos/${alias || cleanName}` });
      }
    };
    // Foto de referencia del trabajador
    addFile(worker.photoUrl, `_referencia${path.extname(worker.photoUrl) || '.jpg'}`);
    // Fotos de marcajes
    for (const m of marks) addFile(m.photoUrl);
    // Fotos de actividades
    for (const a of acts) { addFile(a.startPhotoUrl); addFile(a.endPhotoUrl); }
    // Adjuntos de justificaciones
    for (const j of justs) if (j.attachmentUrl) addFile(j.attachmentUrl);

    await zip.finalize();
  }
}
