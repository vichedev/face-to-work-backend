import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Attendance, AttendanceType, MatchStatus } from './attendance.entity';
import { Activity } from '../activities/activity.entity';
import { User } from '../users/user.entity';
import { FaceService } from '../face/face.service';
import { UploadsService } from '../uploads/uploads.service';
import { WorkScheduleService } from '../schedule/work-schedule.service';
import { MarkDto } from './dto/mark.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

/** Secuencia esperada de marcajes en un día. lunch puede saltarse. */
const SEQUENCE: AttendanceType[] = ['in', 'lunch_out', 'lunch_in', 'out'];
function nextInSequence(last: AttendanceType | undefined): AttendanceType {
  if (!last) return 'in';
  const i = SEQUENCE.indexOf(last);
  if (i < 0 || i === SEQUENCE.length - 1) return 'in';
  return SEQUENCE[i + 1];
}

const DEFAULT_THRESHOLD = 55;

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function monthRange(year: number, month1to12: number): [Date, Date] {
  const start = new Date(year, month1to12 - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month1to12, 0, 23, 59, 59, 999);
  return [start, end];
}
// Interpreta una cadena "YYYY-MM-DD" como una fecha LOCAL (no UTC).
// `new Date('2026-05-12')` se parsea como medianoche UTC, lo que en zonas con offset
// negativo (Ecuador) caería en el día anterior -> los filtros no devolvían nada.
function dayStart(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  return startOfDay(new Date(s));
}
function dayEnd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999);
  return endOfDay(new Date(s));
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger('AttendanceService');

  constructor(
    @InjectRepository(Attendance) private readonly repo: Repository<Attendance>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Activity) private readonly activitiesRepo: Repository<Activity>,
    private readonly faceService: FaceService,
    private readonly uploads: UploadsService,
    private readonly workSchedule: WorkScheduleService,
    private readonly config: ConfigService,
  ) {}

  private get threshold(): number {
    const t = Number(this.config.get<string>('GROQ_MATCH_THRESHOLD'));
    return isFinite(t) && t > 0 ? t : DEFAULT_THRESHOLD;
  }

  // ============================================================
  //  MARCAJE DEL TRABAJADOR AUTENTICADO (desde su propio dashboard)
  // ============================================================
  async markAsWorker(userId: string, dto: MarkDto) {
    const worker = await this.usersRepo.findOne({ where: { id: userId } });
    if (!worker || worker.role !== 'worker') {
      throw new ForbiddenException('Sólo los trabajadores pueden marcar desde su panel');
    }
    if (!dto.photoBase64) throw new BadRequestException('Foto requerida');

    let photoUrl: string;
    try {
      photoUrl = this.uploads.saveDataUrl(dto.photoBase64, 'mark');
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Foto inválida');
    }

    // Marcajes de hoy del trabajador (para determinar el siguiente tipo y si es el primer "in")
    const todays = await this.repo.find({
      where: { workerId: worker.id, createdAt: Between(startOfDay(), endOfDay()) },
      order: { createdAt: 'ASC' },
    });
    const lastToday = todays[todays.length - 1];
    const type: AttendanceType = dto.type ? dto.type : nextInSequence(lastToday?.type);
    const isFirstInOfDay = type === 'in' && !todays.some((a) => a.type === 'in');
    // Hora local del trabajador (la envía el navegador); si no llega, hora del servidor.
    const hour = typeof dto.clientHour === 'number' ? dto.clientHour : new Date().getHours();

    // --- Reconocimiento facial ---
    let matchStatus: MatchStatus;
    let confidence: number;
    let aiReasoning: string;
    let greeting: string;

    if (!worker.faceDescriptor && !worker.photoUrl) {
      const desc = await this.faceService.describeFace(dto.photoBase64);
      // update() para tocar SÓLO estas columnas (un save() del entity dejaría la contraseña en NULL: es select:false)
      await this.usersRepo.update(worker.id, { faceDescriptor: desc, photoUrl });
      worker.faceDescriptor = desc;
      worker.photoUrl = photoUrl;
      matchStatus = 'ai_unavailable';
      confidence = 0;
      aiReasoning = 'Primer marcaje: se guardó esta foto como rostro de referencia.';
      greeting = this.faceService.composeGreeting(worker.name, type, hour);
    } else {
      if (!worker.faceDescriptor && worker.photoUrl) {
        const desc = await this.faceService.describeFace(this.uploads.readAsDataUrl(worker.photoUrl) || dto.photoBase64);
        if (desc) {
          await this.usersRepo.update(worker.id, { faceDescriptor: desc });
          worker.faceDescriptor = desc;
        }
      }
      const referenceUrl = this.uploads.readAsDataUrl(worker.photoUrl);
      const v = await this.faceService.verify(dto.photoBase64, referenceUrl, worker.faceDescriptor, worker.name, { type, hour });
      confidence = v.confidence;
      aiReasoning = v.reasoning;
      greeting = v.greeting;
      if (!v.available) matchStatus = 'ai_unavailable';
      else if (v.match && v.confidence >= this.threshold) matchStatus = 'matched';
      else matchStatus = 'low_confidence';
    }

    // --- Evaluación de la jornada laboral ---
    const schedule = await this.workSchedule.get();
    const ev = this.workSchedule.evaluate({ type, at: new Date(), schedule, isFirstInOfDay });

    // --- Distancia a la oficina (si está configurada) ---
    const distance = WorkScheduleService.haversine(
      dto.latitude ?? null,
      dto.longitude ?? null,
      schedule.officeLatitude ?? null,
      schedule.officeLongitude ?? null,
    );
    const insideOffice = distance != null && distance <= (schedule.officeRadiusMeters || 0);
    const locationLabel =
      (dto.locationLabel || '').trim() ||
      (insideOffice && schedule.officeName ? schedule.officeName : '');

    const record = this.repo.create({
      workerId: worker.id,
      type,
      photoUrl,
      matchStatus,
      recognizedName: worker.name,
      confidence,
      aiReasoning: (aiReasoning || '').slice(0, 1000),
      greeting: (greeting || '').slice(0, 300),
      scheduleStatus: ev.status,
      scheduleMinutes: ev.minutes,
      scheduleNote: (ev.note || '').slice(0, 300),
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      accuracy: dto.accuracy ?? null,
      distanceFromOfficeMeters: distance != null ? Math.round(distance) : null,
      insideOffice,
      locationLabel,
      deviceInfo: (dto.deviceInfo || '').slice(0, 200),
    });
    const saved = await this.repo.save(record);
    const full = await this.repo.findOne({ where: { id: saved.id }, relations: ['worker'] });

    return {
      attendance: full,
      type,
      matchStatus,
      faceVerified: matchStatus === 'matched',
      confidence,
      greeting,
      message: greeting,
      schedule: ev,
      distanceFromOfficeMeters: distance != null ? Math.round(distance) : null,
      insideOffice,
      timestamp: saved.createdAt,
      worker: this.publicWorker(worker),
    };
  }

  /** Estado del día del trabajador autenticado: marcajes de hoy y cuál es la próxima acción. */
  async myToday(userId: string) {
    const todays = await this.repo.find({
      where: { workerId: userId, createdAt: Between(startOfDay(), endOfDay()) },
      order: { createdAt: 'ASC' },
    });
    const last = todays[todays.length - 1];
    const nextAction = nextInSequence(last?.type);
    const firstIn = todays.find((a) => a.type === 'in') || null;
    const lunchOut = todays.find((a) => a.type === 'lunch_out') || null;
    const lunchIn = todays.find((a) => a.type === 'lunch_in') || null;
    const lastOut = [...todays].reverse().find((a) => a.type === 'out') || null;
    const dayDone = !!lastOut;
    // Minutos trabajados = (lastOut o ahora si aún no salió) - firstIn - duración del almuerzo
    let workedMinutes: number | null = null;
    if (firstIn) {
      const endAt = lastOut ? new Date(lastOut.createdAt) : new Date();
      let ms = endAt.getTime() - new Date(firstIn.createdAt).getTime();
      let lunchMs = 0;
      if (lunchOut && lunchIn && new Date(lunchIn.createdAt) > new Date(lunchOut.createdAt)) {
        lunchMs = new Date(lunchIn.createdAt).getTime() - new Date(lunchOut.createdAt).getTime();
      } else if (lunchOut && !lunchIn) {
        // sigue en almuerzo: no contar el tiempo desde lunchOut hasta ahora
        lunchMs = endAt.getTime() - new Date(lunchOut.createdAt).getTime();
      }
      ms -= lunchMs;
      workedMinutes = Math.max(0, Math.round(ms / 60000));
    }
    return {
      date: startOfDay().toISOString(),
      nextAction,
      marks: todays,
      firstIn,
      lunchOut,
      lunchIn,
      lastOut,
      dayDone,
      workedMinutes,
      workedHours: workedMinutes != null ? workedMinutes / 60 : null,
    };
  }

  async myAttendance(userId: string, opts: { month?: string; from?: string; to?: string }) {
    if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
      const [y, m] = opts.month.split('-').map(Number);
      const [start, end] = monthRange(y, m);
      return this.repo.find({ where: { workerId: userId, createdAt: Between(start, end) }, order: { createdAt: 'ASC' } });
    }
    const qb = this.repo.createQueryBuilder('a').where('a.workerId = :id', { id: userId }).orderBy('a.createdAt', 'DESC');
    if (opts.from) qb.andWhere('a.createdAt >= :from', { from: dayStart(opts.from) });
    if (opts.to) qb.andWhere('a.createdAt <= :to', { to: dayEnd(opts.to) });
    qb.limit(2000);
    return qb.getMany();
  }

  // ============================================================
  //  ADMINISTRACIÓN (panel general)
  // ============================================================
  async list(opts: { workerId?: string; from?: string; to?: string; status?: string; limit?: number }) {
    const qb = this.repo.createQueryBuilder('a').leftJoinAndSelect('a.worker', 'w').orderBy('a.createdAt', 'DESC');
    if (opts.workerId) qb.andWhere('a.workerId = :wid', { wid: opts.workerId });
    if (opts.from) qb.andWhere('a.createdAt >= :from', { from: dayStart(opts.from) });
    if (opts.to) qb.andWhere('a.createdAt <= :to', { to: dayEnd(opts.to) });
    if (opts.status === 'identified') qb.andWhere('a.workerId IS NOT NULL');
    if (opts.status === 'unidentified') qb.andWhere('a.workerId IS NULL');
    if (opts.status === 'late') qb.andWhere("a.scheduleStatus IN ('late','absent_threshold')");
    if (opts.status === 'overtime') qb.andWhere("a.scheduleStatus = 'overtime'");
    qb.limit(Math.min(opts.limit || 300, 2000));
    return qb.getMany();
  }

  today() {
    return this.repo.find({
      where: { createdAt: Between(startOfDay(), endOfDay()) },
      relations: ['worker'],
      order: { createdAt: 'DESC' },
    });
  }

  async dashboard() {
    const todays = await this.repo.find({
      where: { createdAt: Between(startOfDay(), endOfDay()) },
      relations: ['worker'],
      order: { createdAt: 'DESC' },
    });
    const totalWorkers = await this.usersRepo.count({ where: { role: 'worker' } });
    const activeWorkers = await this.usersRepo.count({ where: { role: 'worker', active: true } });
    const enrolledWorkers = (
      await this.usersRepo.find({ where: { role: 'worker', active: true }, select: ['id', 'faceDescriptor'] })
    ).filter((w) => !!w.faceDescriptor).length;

    const checkInsToday = todays.filter((a) => a.type === 'in').length;
    const checkOutsToday = todays.filter((a) => a.type === 'out').length;
    const unidentifiedToday = todays.filter((a) => !a.workerId).length;
    const lateToday = todays.filter((a) => a.scheduleStatus === 'late' || a.scheduleStatus === 'absent_threshold').length;
    const overtimeMarksToday = todays.filter((a) => a.scheduleStatus === 'overtime').length;
    const overtimeMinutesToday = todays
      .filter((a) => a.scheduleStatus === 'overtime')
      .reduce((s, a) => s + (a.scheduleMinutes || 0), 0);

    const lastByWorker = new Map<string, Attendance>();
    for (const a of todays) {
      if (a.workerId && !lastByWorker.has(a.workerId)) lastByWorker.set(a.workerId, a);
    }
    const presentNow = [...lastByWorker.values()].filter((a) => a.type === 'in').length;

    const schedule = await this.workSchedule.get();

    return {
      aiEnabled: this.faceService.enabled,
      scheduleEnabled: schedule.enabled,
      totalWorkers,
      activeWorkers,
      enrolledWorkers,
      checkInsToday,
      checkOutsToday,
      presentNow,
      unidentifiedToday,
      lateToday,
      overtimeMarksToday,
      overtimeMinutesToday,
      recent: todays.slice(0, 12),
    };
  }

  /**
   * Series y rankings agregados para el dashboard analítico. Devuelve:
   *  - hoursPerDay: minutos efectivamente trabajados por día (últimos N días).
   *  - marksPerDay: cuántos marcajes hubo cada día (todos los tipos).
   *  - topWorkers: top N trabajadores por horas trabajadas en el mes.
   *  - statusBreakdown: distribución de scheduleStatus en el mes.
   */
  async analytics(days = 30) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setDate(from.getDate() - (days - 1));
    const toEnd = new Date(today);
    toEnd.setHours(23, 59, 59, 999);

    const marks = await this.repo.find({
      where: { createdAt: Between(from, toEnd) },
      relations: ['worker'],
      order: { createdAt: 'ASC' },
    });

    // Agrupa por workerId + día → calcular minutos trabajados de cada día
    const byWorkerDay = new Map<string, Map<string, Attendance[]>>();
    const marksPerDay = new Map<string, number>();
    for (const a of marks) {
      const d = new Date(a.createdAt);
      d.setHours(0, 0, 0, 0);
      const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      marksPerDay.set(dayStr, (marksPerDay.get(dayStr) || 0) + 1);
      if (!a.workerId) continue;
      if (!byWorkerDay.has(a.workerId)) byWorkerDay.set(a.workerId, new Map());
      const wMap = byWorkerDay.get(a.workerId)!;
      if (!wMap.has(dayStr)) wMap.set(dayStr, []);
      wMap.get(dayStr)!.push(a);
    }

    function workedMin(list: Attendance[]): number {
      const sorted = [...list].sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
      const firstIn = sorted.find((m) => m.type === 'in');
      const lastOut = [...sorted].reverse().find((m) => m.type === 'out');
      if (!firstIn || !lastOut) return 0;
      let ms = new Date(lastOut.createdAt).getTime() - new Date(firstIn.createdAt).getTime();
      const lOut = sorted.find((m) => m.type === 'lunch_out');
      const lIn = sorted.find((m) => m.type === 'lunch_in');
      if (lOut && lIn) {
        ms -= Math.max(0, new Date(lIn.createdAt).getTime() - new Date(lOut.createdAt).getTime());
      }
      return Math.max(0, Math.round(ms / 60000));
    }

    // Acumular minutos por día (sumando todos los workers)
    const minutesPerDay = new Map<string, number>();
    for (const [, wMap] of byWorkerDay) {
      for (const [day, list] of wMap) {
        minutesPerDay.set(day, (minutesPerDay.get(day) || 0) + workedMin(list));
      }
    }

    // Generar arr completo (incluso días con 0 marcajes)
    const hoursPerDay: Array<{ day: string; hours: number; marks: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      hoursPerDay.push({
        day: dayStr,
        hours: Math.round(((minutesPerDay.get(dayStr) || 0) / 60) * 10) / 10,
        marks: marksPerDay.get(dayStr) || 0,
      });
    }

    // Top trabajadores del MES (mes calendario actual)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const totalByWorker = new Map<string, { id: string; name: string; minutes: number; lateMinutes: number }>();
    for (const [workerId, wMap] of byWorkerDay) {
      let minutes = 0;
      let lateMinutes = 0;
      let name = '';
      for (const [dayStr, list] of wMap) {
        const dt = new Date(dayStr);
        if (dt < monthStart) continue;
        minutes += workedMin(list);
        lateMinutes += list.filter((m) => m.scheduleStatus === 'late').reduce((s, m) => s + (m.scheduleMinutes || 0), 0);
        if (!name && list[0]?.worker?.name) name = list[0].worker.name;
      }
      if (minutes > 0 || lateMinutes > 0) {
        totalByWorker.set(workerId, { id: workerId, name: name || 'Trabajador', minutes, lateMinutes });
      }
    }
    const topWorkers = [...totalByWorker.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 8);

    // Distribución de status del mes
    const statusCounts: Record<string, number> = {};
    for (const a of marks) {
      const dt = new Date(a.createdAt);
      if (dt < monthStart) continue;
      const k = a.scheduleStatus || 'normal';
      statusCounts[k] = (statusCounts[k] || 0) + 1;
    }
    const statusBreakdown = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

    return { days, from, to: toEnd, hoursPerDay, topWorkers, statusBreakdown };
  }

  /**
   * Devuelve todos los marcajes geolocalizados (lat/lng != null) de un día,
   * más la oficina (si está configurada). Usado por la página `/admin/map`.
   */
  async mapPoints(dayStr?: string) {
    const parse = (s?: string): Date => {
      if (s && /^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, d] = s.slice(0, 10).split('-').map(Number);
        return new Date(y, m - 1, d);
      }
      return new Date();
    };
    const date = parse(dayStr);
    const from = startOfDay(date);
    const to = endOfDay(date);

    const marks = await this.repo.find({
      where: { createdAt: Between(from, to) },
      relations: ['worker'],
      order: { createdAt: 'ASC' },
    });

    const points = marks
      .filter((m) => m.latitude != null && m.longitude != null)
      .map((m) => ({
        id: m.id,
        kind: 'attendance' as const,
        type: m.type,
        lat: m.latitude,
        lng: m.longitude,
        accuracy: m.accuracy,
        createdAt: m.createdAt,
        worker: m.worker ? { id: m.worker.id, name: m.worker.name, code: m.worker.code, photoUrl: m.worker.photoUrl } : null,
        scheduleStatus: m.scheduleStatus,
        distanceFromOfficeMeters: m.distanceFromOfficeMeters,
        insideOffice: m.insideOffice,
        locationLabel: m.locationLabel,
      }));

    // Actividades: pueden tener startLat/Lng y/o endLat/Lng. Las agregamos como
    // dos puntos distintos al mapa (uno por inicio, otro por fin) para verlas
    // como recorrido.
    const activities = await this.activitiesRepo.find({
      where: { startedAt: Between(from, to) },
      relations: ['worker'],
    });
    for (const a of activities) {
      const pubWorker = a.worker ? { id: a.worker.id, name: a.worker.name, code: a.worker.code, photoUrl: a.worker.photoUrl } : null;
      if (a.startLatitude != null && a.startLongitude != null) {
        points.push({
          id: `${a.id}-start`,
          kind: 'activity_start' as any,
          type: a.status,
          lat: a.startLatitude,
          lng: a.startLongitude,
          accuracy: a.startAccuracy,
          createdAt: a.startedAt,
          worker: pubWorker,
          scheduleStatus: '',
          distanceFromOfficeMeters: null,
          insideOffice: false,
          locationLabel: a.title,
        } as any);
      }
      if (a.endLatitude != null && a.endLongitude != null && a.endedAt) {
        points.push({
          id: `${a.id}-end`,
          kind: 'activity_end' as any,
          type: a.status,
          lat: a.endLatitude,
          lng: a.endLongitude,
          accuracy: a.endAccuracy,
          createdAt: a.endedAt,
          worker: pubWorker,
          scheduleStatus: '',
          distanceFromOfficeMeters: null,
          insideOffice: false,
          locationLabel: a.title,
        } as any);
      }
    }

    const schedule = await this.workSchedule.get();
    const office = schedule.officeLatitude != null && schedule.officeLongitude != null
      ? {
          name: schedule.officeName || 'Oficina',
          lat: schedule.officeLatitude,
          lng: schedule.officeLongitude,
          radiusMeters: schedule.officeRadiusMeters || 100,
          geofenceEnabled: !!schedule.geofenceEnabled,
        }
      : null;

    return {
      day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      office,
      points,
    };
  }

  /** Devuelve un marcaje (con su worker) para uso del controlador (audit log, etc.). */
  findOne(id: string) {
    return this.repo.findOne({ where: { id }, relations: ['worker'] });
  }

  /** Corrección de un marcaje por un administrador (re-evalúa la jornada con la config vigente). */
  async adminUpdate(id: string, dto: UpdateAttendanceDto) {
    const rec = await this.repo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Marcaje no encontrado');
    if (dto.type === 'in' || dto.type === 'out') rec.type = dto.type;
    if (dto.locationLabel !== undefined) rec.locationLabel = dto.locationLabel.trim().slice(0, 200);
    if (dto.createdAt) {
      const d = new Date(dto.createdAt);
      if (isNaN(d.getTime())) throw new BadRequestException('Fecha inválida');
      rec.createdAt = d;
    }
    if (rec.workerId) {
      const at = new Date(rec.createdAt);
      const dayMarks = await this.repo.find({
        where: { workerId: rec.workerId, createdAt: Between(startOfDay(at), endOfDay(at)) },
        order: { createdAt: 'ASC' },
      });
      const isFirstInOfDay =
        rec.type === 'in' &&
        !dayMarks.some((m) => m.id !== rec.id && m.type === 'in' && new Date(m.createdAt) <= at);
      const schedule = await this.workSchedule.get();
      const ev = this.workSchedule.evaluate({ type: rec.type, at, schedule, isFirstInOfDay });
      rec.scheduleStatus = ev.status;
      rec.scheduleMinutes = ev.minutes;
      rec.scheduleNote = (ev.note || '').slice(0, 300);
    }
    await this.repo.save(rec);
    return this.repo.findOne({ where: { id }, relations: ['worker'] });
  }

  async adminRemove(id: string) {
    const rec = await this.repo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Marcaje no encontrado');
    await this.repo.remove(rec);
    return { ok: true };
  }

  // ---- helpers ----
  private publicWorker(w: User) {
    return {
      id: w.id,
      name: w.name,
      code: w.code,
      position: w.position,
      department: w.department,
      photoUrl: w.photoUrl,
      email: w.email,
    };
  }
}
