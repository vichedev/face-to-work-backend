import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EomReward } from './eom-reward.entity';

export interface UpsertRewardDto {
  emoji?: string;
  label?: string;
  description?: string;
  sortOrder?: number;
  active?: boolean;
}

@Injectable()
export class EomRewardsService {
  constructor(@InjectRepository(EomReward) private readonly repo: Repository<EomReward>) {}

  list(includeInactive = false) {
    const qb = this.repo.createQueryBuilder('r').orderBy('r.sortOrder', 'ASC').addOrderBy('r.createdAt', 'ASC');
    if (!includeInactive) qb.where('r.active = :a', { a: true });
    return qb.getMany();
  }

  async create(dto: UpsertRewardDto): Promise<EomReward> {
    if (!dto.label?.trim()) throw new BadRequestException('El nombre de la recompensa es obligatorio');
    // Si no especifica sortOrder, lo manda al final.
    let order = dto.sortOrder;
    if (typeof order !== 'number') {
      const last = await this.repo.find({ order: { sortOrder: 'DESC' }, take: 1 });
      order = (last[0]?.sortOrder ?? -1) + 10;
    }
    return this.repo.save(this.repo.create({
      emoji: (dto.emoji || '🏆').slice(0, 16),
      label: dto.label.trim().slice(0, 120),
      description: (dto.description || '').trim().slice(0, 2000),
      sortOrder: order,
      active: dto.active ?? true,
    }));
  }

  async update(id: string, dto: UpsertRewardDto): Promise<EomReward> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Recompensa no encontrada');
    if (dto.emoji !== undefined) r.emoji = dto.emoji.slice(0, 16) || '🏆';
    if (dto.label !== undefined) {
      if (!dto.label.trim()) throw new BadRequestException('El nombre no puede quedar vacío');
      r.label = dto.label.trim().slice(0, 120);
    }
    if (dto.description !== undefined) r.description = String(dto.description).trim().slice(0, 2000);
    if (dto.sortOrder !== undefined) r.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) r.active = !!dto.active;
    return this.repo.save(r);
  }

  async remove(id: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Recompensa no encontrada');
    await this.repo.remove(r);
    return { ok: true };
  }
}
