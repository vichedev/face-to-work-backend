import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { ActivitiesService } from './activities.service';
import { AuditService, auditCtx } from '../audit/audit.service';
import { StartActivityDto } from './dto/start-activity.dto';
import { EndActivityDto } from './dto/end-activity.dto';
import { AdminUpdateActivityDto } from './dto/admin-update-activity.dto';

function snapshotActivity(a: any) {
  if (!a) return null;
  return {
    id: a.id,
    workerId: a.workerId,
    title: a.title,
    status: a.status,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    durationMinutes: a.durationMinutes,
  };
}

@Controller('activities')
export class ActivitiesController {
  constructor(
    private readonly service: ActivitiesService,
    private readonly audit: AuditService,
  ) {}

  // -- Trabajador --
  @UseGuards(JwtAuthGuard)
  @Post('start')
  start(@Req() req: any, @Body() dto: StartActivityDto) {
    return this.service.start(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/end')
  end(@Req() req: any, @Param('id') id: string, @Body() dto: EndActivityDto) {
    return this.service.end(req.user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/current')
  current(@Req() req: any) {
    return this.service.findCurrent(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  mine(
    @Req() req: any,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findMine(req.user.id, { month, from, to });
  }

  // -- Vista individual: trabajador su propia, admin cualquiera --
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const a = await this.service.findOne(id);
    if (req.user.role !== 'admin' && a.workerId !== req.user.id) {
      throw new ForbiddenException('No tienes acceso a esta actividad');
    }
    return a;
  }

  // -- Administración --
  @UseGuards(AdminGuard)
  @Get()
  list(
    @Query('workerId') workerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({ workerId, from, to, status, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: AdminUpdateActivityDto) {
    const before = await this.service.findOne(id);
    const updated = await this.service.adminUpdate(id, dto);
    await this.audit.record(auditCtx(req), {
      entity: 'activity',
      entityId: id,
      action: 'update',
      summary: `Corrigió actividad "${updated?.title || ''}" de ${before?.worker?.name || 'trabajador'}`,
      before: snapshotActivity(before),
      after: snapshotActivity(updated),
    });
    return updated;
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const before = await this.service.findOne(id);
    const result = await this.service.adminRemove(id);
    await this.audit.record(auditCtx(req), {
      entity: 'activity',
      entityId: id,
      action: 'delete',
      summary: `Eliminó actividad "${before?.title || ''}" de ${before?.worker?.name || 'trabajador'}`,
      before: snapshotActivity(before),
      after: null,
    });
    return result;
  }
}
