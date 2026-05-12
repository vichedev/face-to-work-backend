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
import { User } from '../users/user.entity';
import { FaceService } from '../face/face.service';
import { UploadsService } from '../uploads/uploads.service';
import { MarkDto } from './dto/mark.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

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

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger('AttendanceService');

  constructor(
    @InjectRepository(Attendance) private readonly repo: Repository<Attendance>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly faceService: FaceService,
    private readonly uploads: UploadsService,
    private readonly config: ConfigService,
  ) {}

  private get threshold(): number {
    const t = Number(this.config.get<string>('GROQ_MATCH_THRESHOLD'));
    return isFinite(t) && t > 0 ? t : DEFAULT_THRESHOLD;
  }

  /** Tipo de marcaje a registrar para un trabajador: alterna según su último marcaje de hoy. */
  private async nextTypeFor(workerId: string): Promise<AttendanceType> {
    const last = await this.repo.find({
      where: { workerId, createdAt: Between(startOfDay(), endOfDay()) },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    return last[0]?.type === 'in' ? 'out' : 'in';
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

    const type: AttendanceType =
      dto.type === 'in' || dto.type === 'out' ? dto.type : await this.nextTypeFor(worker.id);
    const hour = new Date().getHours();

    // Autoinscripción del rostro en el primer marcaje (si aún no tiene descriptor)
    if (!worker.faceDescriptor) {
      const desc = await this.faceService.describeFace(dto.photoBase64);
      if (desc) {
        worker.faceDescriptor = desc;
        if (!worker.photoUrl) worker.photoUrl = photoUrl;
        await this.usersRepo.save(worker);
      }
    }

    const v = await this.faceService.verify(dto.photoBase64, worker.faceDescriptor, worker.name, { type, hour });

    let matchStatus: MatchStatus;
    if (!v.available) matchStatus = 'ai_unavailable';
    else if (v.match && v.confidence >= this.threshold) matchStatus = 'matched';
    else matchStatus = 'low_confidence';

    const record = this.repo.create({
      workerId: worker.id,
      type,
      photoUrl,
      matchStatus,
      recognizedName: worker.name,
      confidence: v.confidence,
      aiReasoning: (v.reasoning || '').slice(0, 1000),
      greeting: (v.greeting || '').slice(0, 300),
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      accuracy: dto.accuracy ?? null,
      locationLabel: (dto.locationLabel || '').trim(),
      deviceInfo: (dto.deviceInfo || '').slice(0, 200),
    });
    const saved = await this.repo.save(record);
    const full = await this.repo.findOne({ where: { id: saved.id }, relations: ['worker'] });

    return {
      attendance: full,
      type,
      matchStatus,
      faceVerified: matchStatus === 'matched',
      confidence: v.confidence,
      greeting: v.greeting,
      message: v.greeting,
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
    const nextAction: AttendanceType = last?.type === 'in' ? 'out' : 'in';
    const firstIn = todays.find((a) => a.type === 'in') || null;
    const lastOut = [...todays].reverse().find((a) => a.type === 'out') || null;
    let workedHours: number | null = null;
    if (firstIn && lastOut && new Date(lastOut.createdAt) > new Date(firstIn.createdAt)) {
      workedHours = (new Date(lastOut.createdAt).getTime() - new Date(firstIn.createdAt).getTime()) / 3600000;
    }
    return { date: startOfDay().toISOString(), nextAction, marks: todays, firstIn, lastOut, workedHours };
  }

  /** Marcajes del trabajador autenticado (todos, por mes o por rango). Sólo lectura para el trabajador. */
  async myAttendance(userId: string, opts: { month?: string; from?: string; to?: string }) {
    if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
      const [y, m] = opts.month.split('-').map(Number);
      const [start, end] = monthRange(y, m);
      return this.repo.find({ where: { workerId: userId, createdAt: Between(start, end) }, order: { createdAt: 'ASC' } });
    }
    const qb = this.repo.createQueryBuilder('a').where('a.workerId = :id', { id: userId }).orderBy('a.createdAt', 'DESC');
    if (opts.from) qb.andWhere('a.createdAt >= :from', { from: startOfDay(new Date(opts.from)) });
    if (opts.to) qb.andWhere('a.createdAt <= :to', { to: endOfDay(new Date(opts.to)) });
    qb.limit(2000);
    return qb.getMany();
  }

  // ============================================================
  //  ADMINISTRACIÓN (panel general)
  // ============================================================
  async list(opts: { workerId?: string; from?: string; to?: string; status?: string; limit?: number }) {
    const qb = this.repo.createQueryBuilder('a').leftJoinAndSelect('a.worker', 'w').orderBy('a.createdAt', 'DESC');
    if (opts.workerId) qb.andWhere('a.workerId = :wid', { wid: opts.workerId });
    if (opts.from) qb.andWhere('a.createdAt >= :from', { from: startOfDay(new Date(opts.from)) });
    if (opts.to) qb.andWhere('a.createdAt <= :to', { to: endOfDay(new Date(opts.to)) });
    if (opts.status === 'identified') qb.andWhere('a.workerId IS NOT NULL');
    if (opts.status === 'unidentified') qb.andWhere('a.workerId IS NULL');
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

    const lastByWorker = new Map<string, Attendance>();
    for (const a of todays) {
      if (a.workerId && !lastByWorker.has(a.workerId)) lastByWorker.set(a.workerId, a);
    }
    const presentNow = [...lastByWorker.values()].filter((a) => a.type === 'in').length;

    return {
      aiEnabled: this.faceService.enabled,
      totalWorkers,
      activeWorkers,
      enrolledWorkers,
      checkInsToday,
      checkOutsToday,
      presentNow,
      unidentifiedToday,
      recent: todays.slice(0, 12),
    };
  }

  /** Corrección de un marcaje por un administrador. */
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
    await this.repo.save(rec);
    return this.repo.findOne({ where: { id }, relations: ['worker'] });
  }

  /** Eliminación de un marcaje por un administrador. */
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
