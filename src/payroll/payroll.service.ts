import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Attendance } from '../attendance/attendance.entity';
import { Activity } from '../activities/activity.entity';
import { Justification } from '../justifications/justification.entity';
import { User } from '../users/user.entity';
import { WorkScheduleService } from '../schedule/work-schedule.service';
import { WorkSchedule } from '../schedule/work-schedule.entity';

function pad2(n: number) { return String(n).padStart(2, '0'); }
function dayKey(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthRange(year: number, month1: number): [Date, Date] {
  return [new Date(year, month1 - 1, 1, 0, 0, 0, 0), new Date(year, month1, 0, 23, 59, 59, 999)];
}

function parseHHmm(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}

export interface DailyRow {
  date: string;        // YYYY-MM-DD
  weekday: string;     // 'Lun', 'Mar', …
  isWorkDay: boolean;
  shift: { start: string; end: string } | null;
  firstIn: string | null;     // 'HH:mm'
  lunchOut: string | null;
  lunchIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  earlyLeaveMinutes: number;
  status: 'present' | 'late' | 'absent' | 'justified' | 'rest' | 'holiday' | 'partial';
  justification?: { type: string; reason: string } | null;
  activitiesCount: number;
}

export interface MonthlyPayroll {
  worker: { id: string; name: string; code: string | null; position: string; department: string; email: string; photoUrl: string };
  month: { year: number; month: number; label: string };
  schedule: { enabled: boolean; lateAfterMinutes: number };
  totals: {
    workDays: number;          // días laborables del mes (según jornada)
    workedDays: number;        // días con entrada y salida registradas
    workedMinutes: number;     // minutos efectivamente trabajados
    overtimeMinutes: number;
    lateDays: number;
    lateMinutes: number;
    earlyLeaveDays: number;
    earlyLeaveMinutes: number;
    absentDays: number;        // ausencias no justificadas
    justifiedDays: number;     // días cubiertos por una justificación aprobada
    restDays: number;
    holidayDays: number;
    activitiesCount: number;
    activitiesMinutes: number;
  };
  daily: DailyRow[];
}

const WEEKDAY = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

@Injectable()
export class PayrollService {
  constructor(
    @InjectRepository(Attendance) private readonly attRepo: Repository<Attendance>,
    @InjectRepository(Activity) private readonly actRepo: Repository<Activity>,
    @InjectRepository(Justification) private readonly justRepo: Repository<Justification>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly workSchedule: WorkScheduleService,
  ) {}

  /**
   * Devuelve la serie de N meses anteriores (incluido el actual) con totales clave
   * por mes. Útil para el dashboard de evolución por trabajador.
   */
  async monthlyTrend(workerId: string, months = 6) {
    const now = new Date();
    const series: Array<{
      month: string;       // 'YYYY-MM'
      label: string;       // 'may. 2026'
      workedHours: number;
      overtimeHours: number;
      lateDays: number;
      lateMinutes: number;
      absentDays: number;
      justifiedDays: number;
      workedDays: number;
      activitiesCount: number;
    }> = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const payroll = await this.computeMonth(workerId, y, m);
      series.push({
        month: `${y}-${String(m).padStart(2, '0')}`,
        label: d.toLocaleDateString('es-EC', { month: 'short', year: 'numeric' }),
        workedHours: Math.round((payroll.totals.workedMinutes / 60) * 10) / 10,
        overtimeHours: Math.round((payroll.totals.overtimeMinutes / 60) * 10) / 10,
        lateDays: payroll.totals.lateDays,
        lateMinutes: payroll.totals.lateMinutes,
        absentDays: payroll.totals.absentDays,
        justifiedDays: payroll.totals.justifiedDays,
        workedDays: payroll.totals.workedDays,
        activitiesCount: payroll.totals.activitiesCount,
      });
    }
    return { workerId, months, series };
  }

  async computeMonth(workerId: string, year: number, month1: number): Promise<MonthlyPayroll> {
    const worker = await this.usersRepo.findOne({ where: { id: workerId } });
    if (!worker) throw new NotFoundException('Trabajador no encontrado');

    const schedule = await this.workSchedule.get();
    const [from, to] = monthRange(year, month1);

    const [marks, activities, justifications] = await Promise.all([
      this.attRepo.find({ where: { workerId, createdAt: Between(from, to) }, order: { createdAt: 'ASC' } }),
      this.actRepo.find({ where: { workerId, startedAt: Between(from, to) } }),
      this.justRepo.find({ where: { workerId } }),
    ]);

    // Indexar marcajes por día local
    const marksByDay = new Map<string, Attendance[]>();
    for (const m of marks) {
      const k = dayKey(new Date(m.createdAt));
      if (!marksByDay.has(k)) marksByDay.set(k, []);
      marksByDay.get(k)!.push(m);
    }
    // Actividades por día
    const actsByDay = new Map<string, Activity[]>();
    for (const a of activities) {
      const k = dayKey(new Date(a.startedAt));
      if (!actsByDay.has(k)) actsByDay.set(k, []);
      actsByDay.get(k)!.push(a);
    }
    // Justificaciones aprobadas que cubren cada día
    const approvedJusts = justifications.filter((j) => j.status === 'approved');
    function findJust(dayStr: string): Justification | null {
      for (const j of approvedJusts) {
        if (dayStr >= j.dateFrom && dayStr <= j.dateTo) return j;
      }
      return null;
    }

    const daily: DailyRow[] = [];
    const totals: MonthlyPayroll['totals'] = {
      workDays: 0, workedDays: 0, workedMinutes: 0, overtimeMinutes: 0,
      lateDays: 0, lateMinutes: 0, earlyLeaveDays: 0, earlyLeaveMinutes: 0,
      absentDays: 0, justifiedDays: 0, restDays: 0, holidayDays: 0,
      activitiesCount: 0, activitiesMinutes: 0,
    };

    const lastDay = new Date(year, month1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const workerCreatedAt = new Date(worker.createdAt); workerCreatedAt.setHours(0, 0, 0, 0);

    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(year, month1 - 1, d);
      const ds = dayKey(date);
      const wkday = date.getDay();
      const day: WorkSchedule['days'] extends infer T ? any : any = (schedule.days || {})[String(wkday)];
      const holiday = (schedule.holidays || []).find((h: any) => h.date === ds);
      const dayActs = actsByDay.get(ds) || [];
      const actMin = dayActs.filter((a) => a.status === 'completed').reduce((s, a) => s + (a.durationMinutes || 0), 0);
      totals.activitiesCount += dayActs.length;
      totals.activitiesMinutes += actMin;

      // Días futuros y previos a la fecha de creación → omitir como fila informativa pero sin marcaje
      const isFuture = date.getTime() > today.getTime();
      const isBeforeCreation = date.getTime() < workerCreatedAt.getTime();

      // Tipo de día
      let isWorkDay = !!schedule.enabled && day?.enabled === true && !holiday;
      let shift: DailyRow['shift'] = null;
      if (isWorkDay && day) shift = { start: day.start || '00:00', end: day.end || '00:00' };

      const dayMarks = marksByDay.get(ds) || [];
      const firstIn = dayMarks.find((m) => m.type === 'in');
      const lunchOut = dayMarks.find((m) => m.type === 'lunch_out');
      const lunchIn = dayMarks.find((m) => m.type === 'lunch_in');
      const lastOut = [...dayMarks].reverse().find((m) => m.type === 'out');

      // Worked minutes = lastOut - firstIn - (lunchIn - lunchOut)
      let worked = 0;
      if (firstIn && lastOut) {
        worked = Math.max(0, Math.round((new Date(lastOut.createdAt).getTime() - new Date(firstIn.createdAt).getTime()) / 60000));
        if (lunchOut && lunchIn) {
          worked -= Math.max(0, Math.round((new Date(lunchIn.createdAt).getTime() - new Date(lunchOut.createdAt).getTime()) / 60000));
        }
      }

      // Late minutes
      let lateMin = 0;
      if (isWorkDay && firstIn && shift) {
        const shiftStart = parseHHmm(shift.start);
        if (shiftStart) {
          const expected = new Date(date); expected.setHours(shiftStart.h, shiftStart.m, 0, 0);
          const actual = new Date(firstIn.createdAt);
          const diff = Math.round((actual.getTime() - expected.getTime()) / 60000);
          if (diff > (schedule.lateAfterMinutes || 0)) lateMin = diff;
        }
      }

      // Overtime: minutos después del shift.end (si overtimeEnabled)
      let overtimeMin = 0;
      if (isWorkDay && schedule.overtimeEnabled && lastOut && shift) {
        const shiftEnd = parseHHmm(shift.end);
        if (shiftEnd) {
          const expected = new Date(date); expected.setHours(shiftEnd.h, shiftEnd.m, 0, 0);
          const actual = new Date(lastOut.createdAt);
          const diff = Math.round((actual.getTime() - expected.getTime()) / 60000);
          if (diff > (schedule.overtimeAfterMinutes || 0)) overtimeMin = diff;
        }
      }

      // Salida anticipada
      let earlyMin = 0;
      if (isWorkDay && schedule.earlyLeaveEnabled && lastOut && shift) {
        const shiftEnd = parseHHmm(shift.end);
        if (shiftEnd) {
          const expected = new Date(date); expected.setHours(shiftEnd.h, shiftEnd.m, 0, 0);
          const actual = new Date(lastOut.createdAt);
          const diff = Math.round((expected.getTime() - actual.getTime()) / 60000);
          if (diff > (schedule.earlyLeaveBeforeMinutes || 0)) earlyMin = diff;
        }
      }

      // Determinar status
      const just = findJust(ds);
      let status: DailyRow['status'] = 'rest';
      if (holiday) status = 'holiday';
      else if (!isWorkDay) status = 'rest';
      else if (isBeforeCreation || isFuture) {
        // Si está antes de ingresar o es futuro, lo marcamos como rest (no aplica)
        status = 'rest';
      } else if (firstIn && lastOut) {
        status = lateMin > 0 ? 'late' : 'present';
      } else if (firstIn && !lastOut) {
        status = 'partial';
      } else if (just) {
        status = 'justified';
      } else {
        status = 'absent';
      }

      // Acumular
      if (status === 'holiday') totals.holidayDays += 1;
      else if (status === 'rest') totals.restDays += 1;
      else {
        totals.workDays += 1;
        if (status === 'present' || status === 'late') {
          totals.workedDays += 1;
          totals.workedMinutes += worked;
          totals.overtimeMinutes += overtimeMin;
          if (lateMin > 0) { totals.lateDays += 1; totals.lateMinutes += lateMin; }
          if (earlyMin > 0) { totals.earlyLeaveDays += 1; totals.earlyLeaveMinutes += earlyMin; }
        } else if (status === 'partial') {
          totals.workedDays += 1;
          totals.workedMinutes += worked;
        } else if (status === 'justified') {
          totals.justifiedDays += 1;
        } else if (status === 'absent') {
          totals.absentDays += 1;
        }
      }

      const fmtTm = (d: Date | string) => {
        const x = new Date(d);
        return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
      };

      daily.push({
        date: ds,
        weekday: WEEKDAY[wkday],
        isWorkDay,
        shift,
        firstIn: firstIn ? fmtTm(firstIn.createdAt) : null,
        lunchOut: lunchOut ? fmtTm(lunchOut.createdAt) : null,
        lunchIn: lunchIn ? fmtTm(lunchIn.createdAt) : null,
        lastOut: lastOut ? fmtTm(lastOut.createdAt) : null,
        workedMinutes: worked,
        lateMinutes: lateMin,
        overtimeMinutes: overtimeMin,
        earlyLeaveMinutes: earlyMin,
        status,
        justification: just ? { type: just.type, reason: just.reason } : null,
        activitiesCount: dayActs.length,
      });
    }

    const monthLabel = new Date(year, month1 - 1, 1).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });

    return {
      worker: {
        id: worker.id,
        name: worker.name,
        code: worker.code,
        position: worker.position,
        department: worker.department,
        email: worker.email,
        photoUrl: worker.photoUrl,
      },
      month: { year, month: month1, label: monthLabel },
      schedule: { enabled: !!schedule.enabled, lateAfterMinutes: schedule.lateAfterMinutes || 0 },
      totals,
      daily,
    };
  }
}
