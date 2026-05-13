import {
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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { AttendanceService } from './attendance.service';
import { AuditService, auditCtx } from '../audit/audit.service';
import { MarkDto } from './dto/mark.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

function snapshotAttendance(a: any) {
  if (!a) return null;
  return {
    id: a.id,
    workerId: a.workerId,
    type: a.type,
    createdAt: a.createdAt,
    locationLabel: a.locationLabel,
    scheduleStatus: a.scheduleStatus,
    scheduleMinutes: a.scheduleMinutes,
  };
}

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly service: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  // --- Trabajador autenticado: marca y consulta desde su propio panel ---

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 10000, limit: 6 } })
  @Post('mark')
  mark(@Req() req: any, @Body() dto: MarkDto) {
    return this.service.markAsWorker(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/today')
  myToday(@Req() req: any) {
    return this.service.myToday(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  myAttendance(
    @Req() req: any,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.myAttendance(req.user.id, { month, from, to });
  }

  // --- Administración (panel general) ---

  @UseGuards(StaffGuard)
  @Get()
  list(
    @Query('workerId') workerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({ workerId, from, to, status, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @UseGuards(StaffGuard)
  @Get('today')
  today() {
    return this.service.today();
  }

  @UseGuards(StaffGuard)
  @Get('summary/dashboard')
  dashboard() {
    return this.service.dashboard();
  }

  @UseGuards(StaffGuard)
  @Get('summary/analytics')
  analytics(@Query('days') days?: string) {
    const n = days ? Math.max(7, Math.min(parseInt(days, 10) || 30, 90)) : 30;
    return this.service.analytics(n);
  }

  /** Devuelve todos los marcajes con coordenadas para un día (para mostrar en mapa). */
  @UseGuards(StaffGuard)
  @Get('summary/map')
  mapPoints(@Query('day') day?: string) {
    return this.service.mapPoints(day);
  }

  // Supervisores pueden CORREGIR marcajes; sólo el admin puede ELIMINAR.
  @UseGuards(StaffGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAttendanceDto) {
    const before = await this.service.findOne(id);
    const updated = await this.service.adminUpdate(id, dto);
    await this.audit.record(auditCtx(req), {
      entity: 'attendance',
      entityId: id,
      action: 'update',
      summary: `Corrigió marcaje ${updated?.type || ''} de ${updated?.worker?.name || 'trabajador'}`,
      before: snapshotAttendance(before),
      after: snapshotAttendance(updated),
    });
    return updated;
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const before = await this.service.findOne(id);
    const result = await this.service.adminRemove(id);
    await this.audit.record(auditCtx(req), {
      entity: 'attendance',
      entityId: id,
      action: 'delete',
      summary: `Eliminó marcaje ${before?.type || ''} de ${before?.worker?.name || 'trabajador'}`,
      before: snapshotAttendance(before),
      after: null,
    });
    return result;
  }
}
