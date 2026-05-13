import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { WorkersService } from './workers.service';
import { WorkersExportService } from './workers-export.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';

@Controller('workers')
export class WorkersController {
  constructor(
    private readonly service: WorkersService,
    private readonly exportService: WorkersExportService,
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
