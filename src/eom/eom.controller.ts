import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { EomService } from './eom.service';
import { EomRewardsService } from './eom-rewards.service';
import { AuditService, auditCtx } from '../audit/audit.service';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

class SetAwardDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  rewardLabel: string;

  @IsOptional() @IsString() @MaxLength(16)
  rewardEmoji?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  rewardDescription?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  message?: string;
}

class UpsertRewardDto {
  @IsOptional() @IsString() @MaxLength(16)
  emoji?: string;

  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  label?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

function parseYearMonth(year: string, month: string): { y: number; m: number } {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!Number.isFinite(y) || y < 2020 || y > 2100) throw new BadRequestException('Año inválido');
  if (!Number.isFinite(m) || m < 1 || m > 12) throw new BadRequestException('Mes inválido (1..12)');
  return { y, m };
}

@Controller('eom')
export class EomController {
  constructor(
    private readonly service: EomService,
    private readonly rewards: EomRewardsService,
    private readonly audit: AuditService,
  ) {}

  // ─────────── Catálogo de recompensas (CRUD admin) ───────────

  /** Lista las recompensas del catálogo. Por defecto solo activas. */
  @UseGuards(StaffGuard)
  @Get('rewards')
  listRewards(@Query('includeInactive') includeInactive?: string) {
    return this.rewards.list(includeInactive === 'true');
  }

  @UseGuards(AdminGuard)
  @Post('rewards')
  createReward(@Req() req: any, @Body() dto: UpsertRewardDto) {
    return this.rewards.create(dto).then(async (r) => {
      await this.audit.record(auditCtx(req), {
        entity: 'eom_reward',
        entityId: r.id,
        action: 'create',
        summary: `Añadió recompensa "${r.emoji} ${r.label}" al catálogo`,
        before: null,
        after: { label: r.label, emoji: r.emoji },
      });
      return r;
    });
  }

  @UseGuards(AdminGuard)
  @Patch('rewards/:id')
  updateReward(@Req() req: any, @Param('id') id: string, @Body() dto: UpsertRewardDto) {
    return this.rewards.update(id, dto).then(async (r) => {
      await this.audit.record(auditCtx(req), {
        entity: 'eom_reward',
        entityId: id,
        action: 'update',
        summary: `Editó recompensa "${r.emoji} ${r.label}"`,
        before: null,
        after: { label: r.label, active: r.active },
      });
      return r;
    });
  }

  @UseGuards(AdminGuard)
  @Delete('rewards/:id')
  removeReward(@Req() req: any, @Param('id') id: string) {
    return this.rewards.remove(id).then(async (out) => {
      await this.audit.record(auditCtx(req), {
        entity: 'eom_reward',
        entityId: id,
        action: 'delete',
        summary: `Eliminó recompensa del catálogo`,
        before: null,
        after: null,
      });
      return out;
    });
  }

  /** Resumen del mes actual: ranking + premio asignado (si existe). Para el panel admin. */
  @UseGuards(StaffGuard)
  @Get('current')
  current(@Query('limit') limit?: string) {
    const n = limit ? Math.max(1, Math.min(parseInt(limit, 10) || 5, 20)) : 5;
    return this.service.currentMonthSummary(n);
  }

  /** Ranking de un mes específico. */
  @UseGuards(StaffGuard)
  @Get('ranking/:year/:month')
  ranking(@Param('year') year: string, @Param('month') month: string, @Query('limit') limit?: string) {
    const { y, m } = parseYearMonth(year, month);
    const n = limit ? Math.max(1, Math.min(parseInt(limit, 10) || 10, 50)) : 10;
    return this.service.ranking(y, m, n);
  }

  /** Award asignado para un mes (o null). */
  @UseGuards(StaffGuard)
  @Get('award/:year/:month')
  getAward(@Param('year') year: string, @Param('month') month: string) {
    const { y, m } = parseYearMonth(year, month);
    return this.service.getAward(y, m);
  }

  /** Asignar / actualizar el premio del mes. Sólo admin: es una decisión administrativa, no operativa. */
  @UseGuards(AdminGuard)
  @Post('award/:year/:month/:workerId')
  async setAward(
    @Req() req: any,
    @Param('year') year: string,
    @Param('month') month: string,
    @Param('workerId') workerId: string,
    @Body() dto: SetAwardDto,
  ) {
    const { y, m } = parseYearMonth(year, month);
    const result = await this.service.setAward(y, m, workerId, dto, req.user.id);
    await this.audit.record(auditCtx(req), {
      entity: 'eom_award',
      entityId: result.id,
      action: 'create',
      summary: `Premió a "${result.worker?.name || workerId}" como empleado del mes ${y}-${String(m).padStart(2, '0')}: ${result.rewardEmoji} ${result.rewardLabel}`,
      before: null,
      after: { workerId, rewardLabel: result.rewardLabel, rewardEmoji: result.rewardEmoji },
    });
    return result;
  }

  /** Quitar el premio del mes (no recomendado, queda en audit). Sólo admin. */
  @UseGuards(AdminGuard)
  @Delete('award/:year/:month')
  async removeAward(@Req() req: any, @Param('year') year: string, @Param('month') month: string) {
    const { y, m } = parseYearMonth(year, month);
    const before = await this.service.getAward(y, m);
    const result = await this.service.removeAward(y, m);
    if (before) {
      await this.audit.record(auditCtx(req), {
        entity: 'eom_award',
        entityId: before.id,
        action: 'delete',
        summary: `Quitó el premio empleado del mes ${y}-${String(m).padStart(2, '0')}`,
        before: { workerId: before.workerId, rewardLabel: before.rewardLabel },
        after: null,
      });
    }
    return result;
  }

  /** Historial: meses anteriores + sus ganadores. */
  @UseGuards(StaffGuard)
  @Get('history')
  history(@Query('limit') limit?: string) {
    return this.service.history(limit ? Math.min(200, parseInt(limit, 10) || 60) : 60);
  }

  /** Trabajador: sus premios obtenidos (para vitrina en su panel). */
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@Req() req: any) {
    return this.service.forWorker(req.user.id);
  }
}
