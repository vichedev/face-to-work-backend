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
import { TasksService } from './tasks.service';
import { AuditService, auditCtx } from '../audit/audit.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly service: TasksService,
    private readonly audit: AuditService,
  ) {}

  // ── Admin ──
  @UseGuards(AdminGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateTaskDto) {
    const t = await this.service.create(req.user.id, dto);
    await this.audit.record(auditCtx(req), {
      entity: 'task',
      entityId: t.id,
      action: 'create',
      summary: `Asignó tarea "${t.title}"`,
      before: null,
      after: { workerId: t.workerId, priority: t.priority, dueAt: t.dueAt },
    });
    return t;
  }

  @UseGuards(AdminGuard)
  @Post('bulk-import')
  async bulkImport(@Req() req: any, @Body() body: { csv: string }) {
    if (!body?.csv || typeof body.csv !== 'string') {
      return { created: 0, errors: [{ row: 0, message: 'Falta el campo "csv" con el contenido del archivo' }] };
    }
    const result = await this.service.importCsv(req.user.id, body.csv);
    if (result.created > 0) {
      await this.audit.record(auditCtx(req), {
        entity: 'task',
        entityId: 'bulk',
        action: 'create',
        summary: `Importó ${result.created} tarea${result.created === 1 ? '' : 's'} desde CSV`,
        before: null,
        after: { created: result.created, errors: result.errors.length },
      });
    }
    return result;
  }

  @UseGuards(AdminGuard)
  @Get()
  list(
    @Query('workerId') workerId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({ workerId, status, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    const before = await this.service.findOne(id);
    const updated = await this.service.adminUpdate(id, dto);
    await this.audit.record(auditCtx(req), {
      entity: 'task',
      entityId: id,
      action: 'update',
      summary: `Editó tarea "${updated.title}"`,
      before: before ? { status: before.status, title: before.title } : null,
      after: { status: updated.status, title: updated.title },
    });
    return updated;
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const before = await this.service.findOne(id);
    const r = await this.service.adminRemove(id);
    await this.audit.record(auditCtx(req), {
      entity: 'task',
      entityId: id,
      action: 'delete',
      summary: `Eliminó tarea "${before?.title || ''}"`,
      before: before ? { workerId: before.workerId, status: before.status } : null,
      after: null,
    });
    return r;
  }

  // ── Worker ──
  @UseGuards(JwtAuthGuard)
  @Get('me')
  mine(@Req() req: any, @Query('status') status?: string) {
    return this.service.findMine(req.user.id, { status });
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/accept')
  accept(@Req() req: any, @Param('id') id: string) {
    return this.service.accept(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/start')
  start(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { latitude?: number; longitude?: number; accuracy?: number; photoBase64?: string },
  ) {
    return this.service.start(req.user.id, id, body || {});
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/complete')
  complete(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { completionNote?: string; latitude?: number; longitude?: number; accuracy?: number; photoBase64?: string },
  ) {
    return this.service.complete(req.user.id, id, body || {});
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/reject')
  reject(@Req() req: any, @Param('id') id: string) {
    return this.service.reject(req.user.id, id);
  }
}
