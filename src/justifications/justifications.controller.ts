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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { JustificationsService } from './justifications.service';
import { AuditService, auditCtx } from '../audit/audit.service';
import { CreateJustificationDto } from './dto/create-justification.dto';
import { DecideJustificationDto } from './dto/decide-justification.dto';

@Controller('justifications')
export class JustificationsController {
  constructor(
    private readonly service: JustificationsService,
    private readonly audit: AuditService,
  ) {}

  // -- Trabajador --
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: any, @Body() dto: CreateJustificationDto) {
    return this.service.create(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  mine(@Req() req: any) {
    return this.service.findMine(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/me')
  cancelMine(@Req() req: any, @Param('id') id: string) {
    return this.service.cancelMine(req.user.id, id);
  }

  // -- Admin --
  @UseGuards(StaffGuard)
  @Get()
  list(
    @Query('workerId') workerId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      workerId,
      status,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(StaffGuard)
  @Patch(':id/decide')
  async decide(@Req() req: any, @Param('id') id: string, @Body() dto: DecideJustificationDto) {
    const before = await this.service.findOne(id);
    const updated = await this.service.decide(id, req.user.id, dto);
    await this.audit.record(auditCtx(req), {
      entity: 'justification',
      entityId: id,
      action: 'update',
      summary: `${dto.decision === 'approved' ? 'Aprobó' : 'Rechazó'} justificación de ${before?.worker?.name || 'trabajador'}`,
      before: before ? { status: before.status, dateFrom: before.dateFrom, dateTo: before.dateTo, type: before.type } : null,
      after: { status: updated.status, adminNote: updated.adminNote, decidedAt: updated.decidedAt },
    });
    return updated;
  }
}
