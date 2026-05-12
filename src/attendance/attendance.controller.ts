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
import { AttendanceService } from './attendance.service';
import { MarkDto } from './dto/mark.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

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

  @UseGuards(AdminGuard)
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

  @UseGuards(AdminGuard)
  @Get('today')
  today() {
    return this.service.today();
  }

  @UseGuards(AdminGuard)
  @Get('summary/dashboard')
  dashboard() {
    return this.service.dashboard();
  }

  // Sólo los administradores pueden corregir o eliminar un marcaje
  @UseGuards(AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAttendanceDto) {
    return this.service.adminUpdate(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.adminRemove(id);
  }
}
