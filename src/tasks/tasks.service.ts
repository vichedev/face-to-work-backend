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
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
    @InjectRepository(Activity) private readonly activitiesRepo: Repository<Activity>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly push: PushService,
  ) {}

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
  async start(workerId: string, id: string, opts: { latitude?: number; longitude?: number; accuracy?: number } = {}): Promise<{ task: Task; activity: Activity }> {
    const t = await this.loadOwned(workerId, id);
    if (t.status === 'in_progress') throw new BadRequestException('Esta tarea ya está en curso');
    if (t.status === 'completed' || t.status === 'cancelled') throw new BadRequestException('Esta tarea ya terminó');

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
      status: 'in_progress',
    });
    const savedAct = await this.activitiesRepo.save(activity);

    t.status = 'in_progress';
    t.activityId = savedAct.id;
    t.startedAt = new Date();
    if (!t.acceptedAt) t.acceptedAt = t.startedAt;
    const savedTask = await this.repo.save(t);
    return { task: savedTask, activity: savedAct };
  }

  async complete(workerId: string, id: string, opts: { completionNote?: string; latitude?: number; longitude?: number; accuracy?: number } = {}): Promise<{ task: Task; activity: Activity | null }> {
    const t = await this.loadOwned(workerId, id);
    if (t.status !== 'in_progress' && t.status !== 'accepted' && t.status !== 'pending') {
      throw new BadRequestException('Esta tarea no se puede terminar');
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
    return { task: savedTask, activity };
  }

  /** El trabajador rechaza la tarea (sólo si está pendiente). El admin la marcará como cancelada o reasignará. */
  async reject(workerId: string, id: string): Promise<Task> {
    const t = await this.loadOwned(workerId, id);
    if (t.status !== 'pending' && t.status !== 'accepted') throw new BadRequestException('Sólo puedes rechazar tareas pendientes o aceptadas');
    t.status = 'cancelled';
    return this.repo.save(t);
  }
}
