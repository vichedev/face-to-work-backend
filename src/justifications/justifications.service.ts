import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Justification } from './justification.entity';
import { User } from '../users/user.entity';
import { UploadsService } from '../uploads/uploads.service';
import { CreateJustificationDto } from './dto/create-justification.dto';
import { DecideJustificationDto } from './dto/decide-justification.dto';

const ALLOWED_ATTACH = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'gif'];
const MAX_ATTACH_BYTES = 8 * 1024 * 1024;

@Injectable()
export class JustificationsService {
  private readonly log = new Logger('JustificationsService');

  constructor(
    @InjectRepository(Justification) private readonly repo: Repository<Justification>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly uploads: UploadsService,
  ) {}

  /** Acepta tanto data URL image/* como application/pdf y guarda en /uploads. */
  private saveAttachment(b64?: string, originalName?: string): string {
    if (!b64) return '';
    try {
      const trimmed = b64.trim();
      const m = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
      if (!m) throw new Error('Adjunto debe ser data URL base64');
      const mime = m[1].toLowerCase();
      const data = m[2];
      let ext = '';
      if (mime === 'application/pdf') ext = 'pdf';
      else if (mime.startsWith('image/')) ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
      if (!ALLOWED_ATTACH.includes(ext)) throw new Error(`Extensión no permitida: ${ext}`);
      const buf = Buffer.from(data, 'base64');
      if (!buf.length) throw new Error('Adjunto vacío');
      if (buf.length > MAX_ATTACH_BYTES) throw new Error('Adjunto demasiado grande (máx 8 MB)');
      const baseName = (originalName || '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60);
      const stem = baseName.replace(/\.[^.]+$/, '') || 'doc';
      const filename = `just-${Date.now()}-${randomBytes(4).toString('hex')}-${stem}.${ext}`;
      const dir = path.resolve(process.cwd(), 'uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), buf);
      return this.uploads.publicUrl(filename);
    } catch (e: any) {
      this.log.warn(`Adjunto de justificación descartado: ${e?.message || e}`);
      return '';
    }
  }

  private validateDates(from: string, to: string) {
    const f = from.slice(0, 10), t = to.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      throw new BadRequestException('Fechas inválidas');
    }
    if (t < f) throw new BadRequestException('La fecha final no puede ser anterior a la inicial');
    return [f, t];
  }

  // -- Trabajador --

  async create(workerId: string, dto: CreateJustificationDto): Promise<Justification> {
    const worker = await this.usersRepo.findOne({ where: { id: workerId } });
    if (!worker || worker.role !== 'worker') {
      throw new ForbiddenException('Sólo los trabajadores pueden enviar justificaciones');
    }
    const [from, to] = this.validateDates(dto.dateFrom, dto.dateTo);
    const attachmentUrl = this.saveAttachment(dto.attachmentBase64, dto.attachmentName);
    const j = this.repo.create({
      workerId,
      dateFrom: from,
      dateTo: to,
      type: dto.type,
      reason: dto.reason.trim(),
      attachmentUrl,
      status: 'pending',
    });
    return this.repo.save(j);
  }

  findMine(workerId: string) {
    return this.repo.find({ where: { workerId }, order: { createdAt: 'DESC' } });
  }

  async cancelMine(workerId: string, id: string) {
    const j = await this.repo.findOne({ where: { id } });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    if (j.workerId !== workerId) throw new ForbiddenException('No es tuya');
    if (j.status !== 'pending') throw new BadRequestException('Sólo se pueden cancelar las pendientes');
    await this.repo.remove(j);
    return { ok: true };
  }

  // -- Admin --

  async findAll(opts: { workerId?: string; status?: string; from?: string; to?: string; limit?: number }) {
    const qb = this.repo
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.worker', 'w')
      .orderBy('j.createdAt', 'DESC');
    if (opts.workerId) qb.andWhere('j.workerId = :wid', { wid: opts.workerId });
    if (opts.status === 'pending' || opts.status === 'approved' || opts.status === 'rejected') {
      qb.andWhere('j.status = :st', { st: opts.status });
    }
    if (opts.from) qb.andWhere('j.dateTo >= :from', { from: opts.from.slice(0, 10) });
    if (opts.to) qb.andWhere('j.dateFrom <= :to', { to: opts.to.slice(0, 10) });
    qb.limit(Math.min(opts.limit || 300, 1000));
    return qb.getMany();
  }

  async findOne(id: string) {
    return this.repo.findOne({ where: { id }, relations: ['worker'] });
  }

  async decide(id: string, adminId: string, dto: DecideJustificationDto) {
    const j = await this.repo.findOne({ where: { id } });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    if (j.status !== 'pending') throw new BadRequestException('Esta justificación ya fue decidida');
    j.status = dto.decision;
    j.adminNote = (dto.adminNote || '').trim();
    j.decidedById = adminId;
    j.decidedAt = new Date();
    return this.repo.save(j);
  }
}
