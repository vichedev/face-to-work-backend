import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AuditAction, AuditLog } from './audit-log.entity';

export interface AuditContext {
  actorId?: string | null;
  actorEmail?: string;
  actorName?: string;
  ip?: string;
  userAgent?: string;
}

export interface RecordParams {
  entity: string;
  entityId: string;
  action: AuditAction;
  summary: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger('AuditService');

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Registra una acción admin. Nunca lanza: si falla, sólo loguea
   * (la auditoría no debe bloquear la operación principal).
   */
  async record(ctx: AuditContext, params: RecordParams): Promise<void> {
    try {
      await this.repo.insert({
        actorId: ctx.actorId ?? null,
        actorEmail: ctx.actorEmail ?? '',
        actorName: ctx.actorName ?? '',
        ip: ctx.ip ?? '',
        userAgent: (ctx.userAgent ?? '').slice(0, 300),
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        summary: params.summary,
        before: params.before ?? null,
        after: params.after ?? null,
      });
    } catch (e: any) {
      this.log.warn(`No se pudo registrar audit log: ${e?.message || e}`);
    }
  }

  async list(opts: {
    entity?: string;
    entityId?: string;
    actorId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (opts.entity) qb.andWhere('a.entity = :e', { e: opts.entity });
    if (opts.entityId) qb.andWhere('a.entityId = :eid', { eid: opts.entityId });
    if (opts.actorId) qb.andWhere('a.actorId = :aid', { aid: opts.actorId });
    if (opts.from) qb.andWhere('a.createdAt >= :from', { from: new Date(opts.from) });
    if (opts.to) {
      const to = new Date(opts.to);
      to.setHours(23, 59, 59, 999);
      qb.andWhere('a.createdAt <= :to', { to });
    }
    qb.limit(Math.min(opts.limit || 200, 1000));
    return qb.getMany();
  }
}

/** Extrae IP + UA + datos del usuario autenticado desde el Request. */
export function auditCtx(req: any): AuditContext {
  const u = req?.user || {};
  const xff = (req?.headers?.['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return {
    actorId: u.id || null,
    actorEmail: u.email || '',
    actorName: u.name || '',
    ip: xff || req?.ip || '',
    userAgent: req?.headers?.['user-agent'] || '',
  };
}
