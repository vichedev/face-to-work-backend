import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { WorkScheduleService } from './work-schedule.service';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

@Controller('schedule')
export class WorkScheduleController {
  constructor(private readonly service: WorkScheduleService) {}

  /** Cualquier usuario autenticado puede ver la jornada (el trabajador la muestra en su panel). */
  @UseGuards(JwtAuthGuard)
  @Get()
  get() {
    return this.service.get();
  }

  /** Sólo el administrador la modifica. */
  @UseGuards(AdminGuard)
  @Patch()
  update(@Body() dto: UpdateScheduleDto) {
    return this.service.update(dto);
  }
}
