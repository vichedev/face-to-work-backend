import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from './task.entity';
import { Activity } from '../activities/activity.entity';
import { User } from '../users/user.entity';
import { PushService } from '../push/push.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
    @InjectRepository(Activity) private readonly activitiesRepo: Repository<Activity>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly push: PushService,
    private readonly uploads: UploadsService,
  ) {}

  private savePhotoOrEmpty(b64: string | undefined, prefix: string): string {
    if (!b64) return '';
    try { return this.uploads.saveDataUrl(b64, prefix); } catch { return ''; }
  }

  // ──────────── Admin ────────────

  async create(adminId: string, dto: CreateTaskDto): Promise<Task> {
    const worker = await this.usersRepo.findOne({ where: { id: dto.workerId } });
    if (!worker || worker.role !== 'worker') throw new BadRequestException('Trabajador inválido');
    const t = this.repo.create({
      workerId: dto.workerId,
      assignedById: adminId,
      title: dto.title.trim(),
      description: (dto.description || '').trim(),
      priority: dto.priority || 'normal',
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      locationLabel: (dto.locationLabel || '').trim(),
      locationLat: dto.locationLat ?? null,
      locationLng: dto.locationLng ?? null,
      requireStartPhoto: !!dto.requireStartPhoto,
      requireEndPhoto: !!dto.requireEndPhoto,
      status: 'pending',
    });
    const saved = await this.repo.save(t);
    // Notificar al trabajador (best-effort, no falla la creación si push falla).
    this.push.notifyUser(saved.workerId, {
      title: 'Nueva tarea asignada',
      body: saved.title + (saved.priority === 'urgent' ? ' · URGENTE' : saved.priority === 'high' ? ' · alta prioridad' : ''),
      url: '/me',
      tag: 'task-' + saved.id,
    }).catch(() => {});
    return saved;
  }

  async findAll(opts: { workerId?: string; status?: string; limit?: number }) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.worker', 'w')
      .leftJoinAndSelect('t.assignedBy', 'a')
      .orderBy('t.createdAt', 'DESC');
    if (opts.workerId) qb.andWhere('t.workerId = :wid', { wid: opts.workerId });
    if (opts.status === 'pending' || opts.status === 'accepted' || opts.status === 'in_progress' || opts.status === 'completed' || opts.status === 'cancelled') {
      qb.andWhere('t.status = :st', { st: opts.status });
    }
    qb.limit(Math.min(opts.limit || 300, 1000));
    return qb.getMany();
  }

  async findOne(id: string) {
    return this.repo.findOne({ where: { id }, relations: ['worker', 'assignedBy'] });
  }

  async adminUpdate(id: string, dto: UpdateTaskDto): Promise<Task> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Tarea no encontrada');
    if (dto.title !== undefined) t.title = dto.title.trim();
    if (dto.description !== undefined) t.description = dto.description.trim();
    if (dto.priority !== undefined) t.priority = dto.priority;
    if (dto.dueAt !== undefined) t.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.locationLabel !== undefined) t.locationLabel = (dto.locationLabel || '').trim();
    if (dto.locationLat !== undefined) t.locationLat = dto.locationLat;
    if (dto.locationLng !== undefined) t.locationLng = dto.locationLng;
    if (dto.status !== undefined) t.status = dto.status;
    if (dto.requireStartPhoto !== undefined) t.requireStartPhoto = !!dto.requireStartPhoto;
    if (dto.requireEndPhoto !== undefined) t.requireEndPhoto = !!dto.requireEndPhoto;
    return this.repo.save(t);
  }

  async adminRemove(id: string) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Tarea no encontrada');
    await this.repo.remove(t);
    return { ok: true };
  }

  // ──────────── Worker ────────────

  findMine(workerId: string, opts: { status?: string } = {}) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignedBy', 'a')
      .where('t.workerId = :wid', { wid: workerId })
      .orderBy('CASE t.status WHEN \'in_progress\' THEN 0 WHEN \'accepted\' THEN 1 WHEN \'pending\' THEN 2 WHEN \'completed\' THEN 3 ELSE 4 END', 'ASC')
      .addOrderBy('t.createdAt', 'DESC');
    if (opts.status === 'pending' || opts.status === 'accepted' || opts.status === 'in_progress' || opts.status === 'completed' || opts.status === 'cancelled') {
      qb.andWhere('t.status = :st', { st: opts.status });
    }
    qb.limit(200);
    return qb.getMany();
  }

  private async loadOwned(workerId: string, id: string): Promise<Task> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Tarea no encontrada');
    if (t.workerId !== workerId) throw new ForbiddenException('Esta tarea no es tuya');
    return t;
  }

  async accept(workerId: string, id: string): Promise<Task> {
    const t = await this.loadOwned(workerId, id);
    if (t.status !== 'pending') throw new BadRequestException('La tarea ya no está pendiente');
    t.status = 'accepted';
    t.acceptedAt = new Date();
    return this.repo.save(t);
  }

  /** Inicia la tarea creando automáticamente una Activity vinculada. */
  async start(workerId: string, id: string, opts: { latitude?: number; longitude?: number; accuracy?: number; photoBase64?: string } = {}): Promise<{ task: Task; activity: Activity }> {
    const t = await this.loadOwned(workerId, id);
    if (t.status === 'in_progress') throw new BadRequestException('Esta tarea ya está en curso');
    if (t.status === 'completed' || t.status === 'cancelled') throw new BadRequestException('Esta tarea ya terminó');
    if (t.requireStartPhoto && !opts.photoBase64) {
      throw new BadRequestException('Esta tarea requiere foto-evidencia al iniciar');
    }

    // Sólo una actividad en curso por trabajador.
    const open = await this.activitiesRepo.findOne({ where: { workerId, status: 'in_progress' } });
    if (open) throw new ConflictException('Ya tienes una actividad en curso. Termínala antes de iniciar otra.');

    const activity = this.activitiesRepo.create({
      workerId,
      title: t.title,
      description: t.description,
      startLatitude: opts.latitude ?? t.locationLat ?? null,
      startLongitude: opts.longitude ?? t.locationLng ?? null,
      startAccuracy: opts.accuracy ?? null,
      startLocationLabel: t.locationLabel || '',
      startPhotoUrl: this.savePhotoOrEmpty(opts.photoBase64, 'task-start'),
      status: 'in_progress',
    });
    const savedAct = await this.activitiesRepo.save(activity);

    t.status = 'in_progress';
    t.activityId = savedAct.id;
    t.startedAt = new Date();
    if (!t.acceptedAt) t.acceptedAt = t.startedAt;
    const savedTask = await this.repo.save(t);
    // Notificar admin
    const worker = await this.usersRepo.findOne({ where: { id: workerId } });
    this.push.notifyAdmins({
      title: `${worker?.name || 'Trabajador'} inició la tarea`,
      body: savedTask.title,
      url: '/admin/tasks',
      tag: 'task-start-' + savedTask.id,
      icon: worker?.photoUrl || undefined,
    }).catch(() => {});
    return { task: savedTask, activity: savedAct };
  }

  async complete(workerId: string, id: string, opts: { completionNote?: string; latitude?: number; longitude?: number; accuracy?: number; photoBase64?: string } = {}): Promise<{ task: Task; activity: Activity | null }> {
    const t = await this.loadOwned(workerId, id);
    if (t.status !== 'in_progress' && t.status !== 'accepted' && t.status !== 'pending') {
      throw new BadRequestException('Esta tarea no se puede terminar');
    }
    if (t.requireEndPhoto && !opts.photoBase64) {
      throw new BadRequestException('Esta tarea requiere foto-evidencia al terminar');
    }
    let activity: Activity | null = null;
    if (t.activityId) {
      const a = await this.activitiesRepo.findOne({ where: { id: t.activityId } });
      if (a && a.status === 'in_progress') {
        const now = new Date();
        a.endedAt = now;
        a.completionNote = (opts.completionNote || '').trim();
        a.endLatitude = opts.latitude ?? null;
        a.endLongitude = opts.longitude ?? null;
        a.endAccuracy = opts.accuracy ?? null;
        a.endPhotoUrl = this.savePhotoOrEmpty(opts.photoBase64, 'task-end');
        a.status = 'completed';
        a.durationMinutes = Math.max(0, Math.round((now.getTime() - new Date(a.startedAt).getTime()) / 60000));
        activity = await this.activitiesRepo.save(a);
      } else {
        activity = a || null;
      }
    }
    t.status = 'completed';
    t.completedAt = new Date();
    const savedTask = await this.repo.save(t);
    const worker = await this.usersRepo.findOne({ where: { id: workerId } });
    const dur = activity?.durationMinutes
      ? (() => { const h = Math.floor(activity.durationMinutes / 60); const m = activity.durationMinutes % 60; return h ? ` · ${h} h ${m} min` : ` · ${m} min`; })()
      : '';
    this.push.notifyAdmins({
      title: `${worker?.name || 'Trabajador'} terminó la tarea`,
      body: savedTask.title + dur,
      url: '/admin/tasks',
      tag: 'task-end-' + savedTask.id,
      icon: worker?.photoUrl || undefined,
    }).catch(() => {});
    return { task: savedTask, activity };
  }

  // ──────────── Bulk import CSV (admin) ────────────

  /**
   * Importa tareas desde un CSV. Cabeceras aceptadas (case-insensitive, en español o inglés):
   *  - workerEmail | trabajador_email | email
   *  - workerCode  | codigo | code
   *  - title       | titulo | título *
   *  - description | descripcion | descripción
   *  - priority    | prioridad ('low'/'normal'/'high'/'urgent' o 'baja'/'normal'/'alta'/'urgente')
   *  - dueAt       | vence (YYYY-MM-DD o YYYY-MM-DDTHH:mm)
   *  - locationLabel | direccion | ubicacion
   *  - requireStartPhoto | foto_inicio (true/1/si)
   *  - requireEndPhoto   | foto_fin    (true/1/si)
   *
   * Resuelve el trabajador por email o por código (lo que venga). Devuelve resumen
   * con creadas + errores por fila para que el admin lo revise.
   */
  async importCsv(adminId: string, csv: string): Promise<{ created: number; errors: Array<{ row: number; message: string }> }> {
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      throw new BadRequestException('El CSV debe tener al menos una fila de cabecera y una de datos');
    }
    const headerMap = normalizeHeaders(rows[0]);
    const required = ['title', 'worker'];
    if (!headerMap.title) throw new BadRequestException('Falta columna "title" (o "titulo")');
    if (!headerMap.workerEmail && !headerMap.workerCode) {
      throw new BadRequestException('Falta columna "workerEmail" o "workerCode"');
    }

    // Cache de workers
    const allWorkers = await this.usersRepo.find({ where: { role: 'worker' } });
    const byEmail = new Map(allWorkers.map((w) => [w.email.toLowerCase(), w]));
    const byCode = new Map(allWorkers.filter((w) => w.code).map((w) => [String(w.code).toLowerCase(), w]));

    const errors: Array<{ row: number; message: string }> = [];
    const toInsert: Partial<Task>[] = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.length || r.every((c) => !c?.trim())) continue; // fila vacía
      try {
        const get = (key: string) => {
          const idx = (headerMap as any)[key];
          return idx == null ? '' : (r[idx] || '').trim();
        };
        const title = get('title');
        if (!title || title.length < 2) throw new Error('Título requerido (≥ 2 caracteres)');

        // Resolver worker
        let worker: User | undefined;
        const email = get('workerEmail').toLowerCase();
        const code = get('workerCode').toLowerCase();
        if (email) worker = byEmail.get(email);
        if (!worker && code) worker = byCode.get(code);
        if (!worker) throw new Error(`No se encontró trabajador con email/código "${email || code}"`);

        // Prioridad
        const pRaw = get('priority').toLowerCase();
        const priorityMap: Record<string, string> = { low: 'low', baja: 'low', normal: 'normal', high: 'high', alta: 'high', urgent: 'urgent', urgente: 'urgent' };
        const priority = (priorityMap[pRaw] || 'normal') as Task['priority'];

        const dueAtRaw = get('dueAt');
        let dueAt: Date | null = null;
        if (dueAtRaw) {
          const d = new Date(dueAtRaw);
          if (!Number.isFinite(d.getTime())) throw new Error(`Fecha "vence" inválida: ${dueAtRaw}`);
          dueAt = d;
        }

        const truthy = (s: string) => ['true', '1', 'si', 'sí', 'yes', 'y'].includes(s.toLowerCase().trim());

        toInsert.push({
          workerId: worker.id,
          assignedById: adminId,
          title,
          description: get('description'),
          priority,
          dueAt,
          locationLabel: get('locationLabel'),
          requireStartPhoto: truthy(get('requireStartPhoto')),
          requireEndPhoto: truthy(get('requireEndPhoto')),
          status: 'pending',
        });
      } catch (e: any) {
        errors.push({ row: i + 1, message: e?.message || String(e) });
      }
    }

    const saved = toInsert.length ? await this.repo.save(toInsert.map((d) => this.repo.create(d as any)) as any) : [];
    // Notificaciones push (best-effort)
    for (const t of saved as Task[]) {
      this.push.notifyUser(t.workerId, {
        title: 'Nueva tarea asignada',
        body: t.title + (t.priority === 'urgent' ? ' · URGENTE' : t.priority === 'high' ? ' · alta prioridad' : ''),
        url: '/me',
        tag: 'task-' + t.id,
      }).catch(() => {});
    }

    return { created: (saved as any[]).length, errors };
  }

  /** El trabajador rechaza la tarea (sólo si está pendiente). El admin la marcará como cancelada o reasignará. */
  async reject(workerId: string, id: string): Promise<Task> {
    const t = await this.loadOwned(workerId, id);
    if (t.status !== 'pending' && t.status !== 'accepted') throw new BadRequestException('Sólo puedes rechazar tareas pendientes o aceptadas');
    t.status = 'cancelled';
    return this.repo.save(t);
  }
}

// ─────────── helpers CSV (puros, sin dependencias) ───────────

/**
 * Parser CSV minimalista pero RFC-4180-compatible:
 *  - Soporta comillas dobles para escapar comas / saltos de línea / "" como ".
 *  - Acepta separador `,` o `;` (se autodetecta del primer renglón).
 *  - Maneja BOM al inicio y \r\n / \n.
 */
function parseCsv(input: string): string[][] {
  if (!input) return [];
  let s = input;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // BOM
  // autodetectar separador con la primera línea
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip, manejamos \n */ }
      else field += ch;
    }
  }
  // último campo / fila
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 0 && r.some((c) => c.length > 0));
}

interface HeaderMap {
  title?: number;
  description?: number;
  priority?: number;
  dueAt?: number;
  locationLabel?: number;
  workerEmail?: number;
  workerCode?: number;
  requireStartPhoto?: number;
  requireEndPhoto?: number;
}

function normalizeHeaders(headerRow: string[]): HeaderMap {
  const map: HeaderMap = {};
  const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (let i = 0; i < headerRow.length; i++) {
    const h = stripDiacritics(String(headerRow[i] || '').trim().toLowerCase());
    if (h === 'title' || h === 'titulo') map.title = i;
    else if (h === 'description' || h === 'descripcion') map.description = i;
    else if (h === 'priority' || h === 'prioridad') map.priority = i;
    else if (h === 'dueat' || h === 'vence' || h === 'due') map.dueAt = i;
    else if (h === 'locationlabel' || h === 'direccion' || h === 'ubicacion' || h === 'lugar') map.locationLabel = i;
    else if (h === 'workeremail' || h === 'trabajador_email' || h === 'email' || h === 'correo') map.workerEmail = i;
    else if (h === 'workercode' || h === 'codigo' || h === 'code' || h === 'cedula') map.workerCode = i;
    else if (h === 'requirestartphoto' || h === 'foto_inicio' || h === 'fotoinicio') map.requireStartPhoto = i;
    else if (h === 'requireendphoto'   || h === 'foto_fin'    || h === 'fotofin')    map.requireEndPhoto = i;
  }
  return map;
}
