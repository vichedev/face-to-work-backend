import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Activity } from './activity.entity';
import { User } from '../users/user.entity';
import { UploadsService } from '../uploads/uploads.service';
import { PushService } from '../push/push.service';
import { StartActivityDto } from './dto/start-activity.dto';
import { EndActivityDto } from './dto/end-activity.dto';
import { AdminUpdateActivityDto } from './dto/admin-update-activity.dto';

function startOfDay(d = new Date()): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function endOfDay(d = new Date()): Date {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
}
function monthRange(year: number, m: number): [Date, Date] {
  return [new Date(year, m - 1, 1, 0, 0, 0, 0), new Date(year, m, 0, 23, 59, 59, 999)];
}
function dayStart(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0) : startOfDay(new Date(s));
}
function dayEnd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999) : endOfDay(new Date(s));
}

@Injectable()
export class ActivitiesService {
  private readonly log = new Logger('ActivitiesService');

  constructor(
    @InjectRepository(Activity) private readonly repo: Repository<Activity>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly uploads: UploadsService,
    private readonly push: PushService,
  ) {}

  private saveOptionalPhoto(b64: string | undefined, prefix: string): string {
    if (!b64) return '';
    try {
      return this.uploads.saveDataUrl(b64, prefix);
    } catch (e: any) {
      this.log.warn(`Foto-evidencia descartada (${prefix}): ${e?.message || e}`);
      return '';
    }
  }

  // -- Trabajador --

  async start(workerId: string, dto: StartActivityDto): Promise<Activity> {
    const worker = await this.usersRepo.findOne({ where: { id: workerId } });
    if (!worker || worker.role !== 'worker') throw new ForbiddenException('Sólo los trabajadores pueden iniciar actividades');
    const open = await this.repo.findOne({ where: { workerId, status: 'in_progress' } });
    if (open) throw new ConflictException('Ya tienes una actividad en curso. Termínala antes de iniciar otra.');
    const startPhotoUrl = this.saveOptionalPhoto(dto.photoBase64, 'act-start');
    const a = this.repo.create({
      workerId,
      title: dto.title.trim(),
      description: (dto.description || '').trim(),
      startLatitude: dto.latitude ?? null,
      startLongitude: dto.longitude ?? null,
      startAccuracy: dto.accuracy ?? null,
      startLocationLabel: (dto.locationLabel || '').trim(),
      startPhotoUrl,
      status: 'in_progress',
    });
    const saved = await this.repo.save(a);
    this.push.notifyAdmins({
      title: `${worker.name} inició actividad`,
      body: saved.title,
      url: '/admin/activities',
      tag: 'act-start-' + saved.id,
      icon: worker.photoUrl || undefined,
    }).catch(() => {});
    return saved;
  }

  async end(workerId: string, id: string, dto: EndActivityDto): Promise<Activity> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Actividad no encontrada');
    if (a.workerId !== workerId) throw new ForbiddenException('No es tu actividad');
    if (a.status !== 'in_progress') throw new BadRequestException('La actividad ya no está en curso');
    const now = new Date();
    a.endedAt = now;
    a.completionNote = (dto.completionNote || '').trim();
    a.endLatitude = dto.latitude ?? null;
    a.endLongitude = dto.longitude ?? null;
    a.endAccuracy = dto.accuracy ?? null;
    a.endLocationLabel = (dto.locationLabel || '').trim();
    a.endPhotoUrl = this.saveOptionalPhoto(dto.photoBase64, 'act-end');
    a.status = 'completed';
    a.durationMinutes = Math.max(0, Math.round((now.getTime() - new Date(a.startedAt).getTime()) / 60000));
    const saved = await this.repo.save(a);
    // Notificar al admin con la duración total
    const worker = await this.usersRepo.findOne({ where: { id: workerId } });
    const h = Math.floor(saved.durationMinutes / 60);
    const m = saved.durationMinutes % 60;
    const dur = h ? `${h} h ${m} min` : `${m} min`;
    this.push.notifyAdmins({
      title: `${worker?.name || 'Trabajador'} terminó actividad`,
      body: `${saved.title} · ${dur}`,
      url: '/admin/activities',
      tag: 'act-end-' + saved.id,
      icon: worker?.photoUrl || undefined,
    }).catch(() => {});
    return saved;
  }

  findCurrent(workerId: string) {
    return this.repo.findOne({ where: { workerId, status: 'in_progress' } });
  }

  async findMine(workerId: string, opts: { month?: string; from?: string; to?: string }) {
    if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
      const [y, m] = opts.month.split('-').map(Number);
      const [start, end] = monthRange(y, m);
      return this.repo.find({ where: { workerId, startedAt: Between(start, end) }, order: { startedAt: 'DESC' } });
    }
    const qb = this.repo.createQueryBuilder('a').where('a.workerId = :id', { id: workerId }).orderBy('a.startedAt', 'DESC');
    if (opts.from) qb.andWhere('a.startedAt >= :from', { from: dayStart(opts.from) });
    if (opts.to) qb.andWhere('a.startedAt <= :to', { to: dayEnd(opts.to) });
    qb.limit(2000);
    return qb.getMany();
  }

  // -- Admin --

  async findAll(opts: { workerId?: string; from?: string; to?: string; status?: string; limit?: number }) {
    const qb = this.repo.createQueryBuilder('a').leftJoinAndSelect('a.worker', 'w').orderBy('a.startedAt', 'DESC');
    if (opts.workerId) qb.andWhere('a.workerId = :wid', { wid: opts.workerId });
    if (opts.from) qb.andWhere('a.startedAt >= :from', { from: dayStart(opts.from) });
    if (opts.to) qb.andWhere('a.startedAt <= :to', { to: dayEnd(opts.to) });
    if (opts.status === 'in_progress' || opts.status === 'completed' || opts.status === 'cancelled') {
      qb.andWhere('a.status = :st', { st: opts.status });
    }
    qb.limit(Math.min(opts.limit || 300, 2000));
    return qb.getMany();
  }

  async findOne(id: string) {
    const a = await this.repo.findOne({ where: { id }, relations: ['worker'] });
    if (!a) throw new NotFoundException('Actividad no encontrada');
    return a;
  }

  async adminUpdate(id: string, dto: AdminUpdateActivityDto): Promise<Activity> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Actividad no encontrada');
    if (dto.title !== undefined) a.title = dto.title;
    if (dto.description !== undefined) a.description = dto.description;
    if (dto.completionNote !== undefined) a.completionNote = dto.completionNote;
    if (dto.startedAt) {
      const d = new Date(dto.startedAt);
      if (isNaN(d.getTime())) throw new BadRequestException('Fecha de inicio inválida');
      a.startedAt = d;
    }
    if (dto.endedAt !== undefined) {
      if (dto.endedAt === null || dto.endedAt === '') {
        a.endedAt = null;
      } else {
        const d = new Date(dto.endedAt);
        if (isNaN(d.getTime())) throw new BadRequestException('Fecha de fin inválida');
        a.endedAt = d;
      }
    }
    if (dto.status) a.status = dto.status;
    // Recalcula duración si hay endedAt
    if (a.endedAt) {
      a.durationMinutes = Math.max(0, Math.round((new Date(a.endedAt).getTime() - new Date(a.startedAt).getTime()) / 60000));
    } else {
      a.durationMinutes = 0;
    }
    return this.repo.save(a);
  }

  async adminRemove(id: string) {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Actividad no encontrada');
    await this.repo.remove(a);
    return { ok: true };
  }
}
