import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffGuard } from '../auth/staff.guard';
import { JustificationsService } from '../justifications/justifications.service';
import { TasksService } from '../tasks/tasks.service';
import { Attendance } from '../attendance/attendance.entity';

/**
 * Endpoints de resumen ligero usados por la SPA (sidebar, indicadores)
 * Devuelve conteos rápidos: justificaciones pendientes, tareas pendientes,
 * marcajes no identificados de hoy, etc.
 */
@UseGuards(StaffGuard)
@Controller('summary')
export class SummaryController {
  constructor(
    @InjectRepository(Attendance) private readonly attRepo: Repository<Attendance>,
    private readonly justifications: JustificationsService,
    private readonly tasks: TasksService,
  ) {}

  @Get('badges')
  async badges() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const [pendingJusts, openTasks, todayMarks] = await Promise.all([
      this.justifications.countPending(),
      this.tasks.countOpen(),
      this.attRepo
        .createQueryBuilder('a')
        .where('a.createdAt >= :from AND a.createdAt < :to', { from: today, to: tomorrow })
        .getMany(),
    ]);
    const unidentifiedToday = todayMarks.filter((m) => !m.workerId).length;
    const lateToday = todayMarks.filter((m) => m.scheduleStatus === 'late').length;

    return {
      pendingJustifications: pendingJusts,
      pendingTasks: openTasks.pending,
      inProgressTasks: openTasks.inProgress,
      unidentifiedToday,
      lateToday,
    };
  }
}
