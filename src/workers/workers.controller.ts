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
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { WorkersService } from './workers.service';
import { WorkersExportService } from './workers-export.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { AuditService, auditCtx } from '../audit/audit.service';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

class UpdateNotesDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000)
  internalNotes?: string;
}

@Controller('workers')
export class WorkersController {
  constructor(
    private readonly service: WorkersService,
    private readonly exportService: WorkersExportService,
    private readonly audit: AuditService,
  ) {}

  // Lectura: admin + supervisor
  @UseGuards(StaffGuard)
  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(includeInactive !== 'false');
  }

  @UseGuards(StaffGuard)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Escritura: solo admin
  @UseGuards(AdminGuard)
  @Post()
  create(@Body() dto: CreateWorkerDto) {
    return this.service.create(dto);
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkerDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  /** Resetea la contraseña del trabajador a una temporal. Devuelve la temporal al admin para que la entregue. */
  @UseGuards(AdminGuard)
  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string) {
    return this.service.resetPassword(id);
  }

  /**
   * Edita las notas internas del trabajador. Disponible para staff (admin + supervisor)
   * porque son útiles para el día a día (alergias, contacto de emergencia, observaciones).
   * Queda registrado en auditoría.
   */
  @UseGuards(StaffGuard)
  @Patch(':id/notes')
  async updateNotes(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateNotesDto) {
    const before = await this.service.findOne(id);
    const after = await this.service.update(id, { internalNotes: dto.internalNotes ?? '' });
    await this.audit.record(auditCtx(req), {
      entity: 'worker',
      entityId: id,
      action: 'update',
      summary: `Editó notas internas de "${after.name}"`,
      before: { internalNotes: before.internalNotes || '' },
      after: { internalNotes: after.internalNotes || '' },
    });
    return { id, internalNotes: after.internalNotes };
  }

  /** ZIP con todo el historial del trabajador (marcajes, actividades, justificaciones, fotos). */
  @UseGuards(StaffGuard)
  @Get(':id/export')
  async export(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const worker = await this.service.findOne(id);
    const filename = `historial-${worker.code || worker.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await this.exportService.exportToStream(id, res, { from, to });
  }
}
