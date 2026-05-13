import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Attendance } from '../attendance/attendance.entity';
import { Activity } from '../activities/activity.entity';
import { User } from '../users/user.entity';
import { WorkScheduleService } from '../schedule/work-schedule.service';
import { WorkSchedule } from '../schedule/work-schedule.entity';

export interface DailyBreakdown {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0..6
  isWorkDay: boolean;
  isHoliday: boolean;
  holidayName: string;
  score: number | null; // null si no era día laborable
  hasIn: boolean;
  hasOut: boolean;
  onTimeStatus: string; // '' | 'on_time' | 'late' | 'absent_threshold'
  earlyLeave: boolean;
  activityCount: number;
  workedMinutes: number; // 0 si no hubo marcajes
  expectedMinutes: number; // según la jornada (0 si día de descanso)
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function dateStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function startOfWeek(d: Date) {
  // Semana lun-dom (estándar latam)
  const x = startOfDay(d);
  const wd = x.getDay();
  const back = (wd + 6) % 7;
  x.setDate(x.getDate() - back);
  return x;
}
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
function parseHM(hhmm: string, base: Date): Date {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function dailyExpectedMinutes(schedule: WorkSchedule, d: Date): number {
  const day = (schedule.days || {})[String(d.getDay())];
  if (!day || !day.enabled) return 0;
  const start = parseHM(day.start, d);
  const end = parseHM(day.end, d);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function workedMinutesForDay(marks: Attendance[]): number {
  if (!marks.length) return 0;
  const firstIn = marks.find((a) => a.type === 'in');
  if (!firstIn) return 0;
  const lastOut = [...marks].reverse().find((a) => a.type === 'out');
  const lunchOut = marks.find((a) => a.type === 'lunch_out');
  const lunchIn = marks.find((a) => a.type === 'lunch_in');
  const endAt = lastOut ? new Date(lastOut.createdAt) : new Date(); // si aún no salió
  let ms = endAt.getTime() - new Date(firstIn.createdAt).getTime();
  let lunchMs = 0;
  if (lunchOut && lunchIn && new Date(lunchIn.createdAt) > new Date(lunchOut.createdAt)) {
    lunchMs = new Date(lunchIn.createdAt).getTime() - new Date(lunchOut.createdAt).getTime();
  } else if (lunchOut && !lunchIn) {
    lunchMs = endAt.getTime() - new Date(lunchOut.createdAt).getTime();
  }
  return Math.max(0, Math.round((ms - lunchMs) / 60000));
}

@Injectable()
export class PerformanceService {
  constructor(
    @InjectRepository(Attendance) private readonly attRepo: Repository<Attendance>,
    @InjectRepository(Activity) private readonly actRepo: Repository<Activity>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly schedule: WorkScheduleService,
  ) {}

  async forWorker(workerId: string, requesterId: string, requesterIsAdmin: boolean) {
    const worker = await this.usersRepo.findOne({ where: { id: workerId } });
    if (!worker || worker.role !== 'worker') throw new NotFoundException('Trabajador no encontrado');
    if (!requesterIsAdmin && requesterId !== workerId) throw new ForbiddenException('Sin acceso');
    return this.compute(worker);
  }

  async compute(worker: User) {
    const now = new Date();
    const windowStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
    const monthStart = startOfMonth(now);
    const weekStart = startOfWeek(now);

    const schedule = await this.schedule.get();

    const attendances = await this.attRepo.find({
      where: { workerId: worker.id, createdAt: Between(windowStart, endOfDay(now)) },
      order: { createdAt: 'ASC' },
    });
    const activities = await this.actRepo.find({
      where: { workerId: worker.id, startedAt: Between(windowStart, endOfDay(now)) },
      order: { startedAt: 'ASC' },
    });

    // Agrupa por día
    const byDay = new Map<string, Attendance[]>();
    for (const a of attendances) {
      const k = dateStr(new Date(a.createdAt));
      const list = byDay.get(k) || [];
      list.push(a);
      byDay.set(k, list);
    }
    const actsByDay = new Map<string, Activity[]>();
    for (const a of activities) {
      const k = dateStr(new Date(a.startedAt));
      const list = actsByDay.get(k) || [];
      list.push(a);
      actsByDay.set(k, list);
    }

    // No penalices días anteriores a la creación del trabajador
    const workerStart = startOfDay(new Date(worker.createdAt || windowStart));
    const daily: DailyBreakdown[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(windowStart);
      d.setDate(d.getDate() + i);
      if (d < workerStart) continue; // antes de existir como trabajador
      const ds = dateStr(d);
      const wd = d.getDay();
      const holiday = (schedule.holidays || []).find((h) => h.date === ds);
      const dayConfig = (schedule.days || {})[String(wd)];
      const isWorkDay = !!schedule.enabled && !!dayConfig?.enabled && !holiday;
      const expectedMinutes = dailyExpectedMinutes(schedule, d);
      const marks = byDay.get(ds) || [];
      const acts = (actsByDay.get(ds) || []).filter((a) => a.status === 'completed');
      const hasIn = marks.some((m) => m.type === 'in');
      const hasOut = marks.some((m) => m.type === 'out');
      const firstIn = marks.find((m) => m.type === 'in');
      const onTimeStatus = firstIn?.scheduleStatus || '';
      const earlyLeave = marks.some((m) => m.type === 'out' && m.scheduleStatus === 'early_leave');
      const workedMinutes = workedMinutesForDay(marks);

      let score: number | null = null;
      if (isWorkDay) {
        let s = 0;
        if (hasIn) s += 30;
        if (hasOut) s += 30;
        // Puntualidad: 20 si on_time, 10 si late, 0 si absent_threshold (o sin entrada)
        if (onTimeStatus === 'on_time') s += 20;
        else if (onTimeStatus === 'late') s += 10;
        // Sin salida anticipada
        if (hasOut && !earlyLeave) s += 10;
        // Actividad registrada
        if (acts.length > 0) s += 10;
        score = Math.max(0, Math.min(100, s));
      }
      daily.push({
        date: ds,
        dayOfWeek: wd,
        isWorkDay,
        isHoliday: !!holiday,
        holidayName: holiday?.name || '',
        score,
        hasIn,
        hasOut,
        onTimeStatus,
        earlyLeave,
        activityCount: acts.length,
        workedMinutes,
        expectedMinutes,
      });
    }

    // Aggregations
    const inRange = (date: string, from: Date) => new Date(date + 'T00:00:00') >= startOfDay(from);
    const monthDays = daily.filter((d) => inRange(d.date, monthStart));
    const weekDays = daily.filter((d) => inRange(d.date, weekStart));
    const todayStr = dateStr(now);
    const todayDay = daily.find((d) => d.date === todayStr) || null;

    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : null);
    const monthWorkScores = monthDays.filter((d) => d.score != null).map((d) => d.score as number);
    const weekWorkScores = weekDays.filter((d) => d.score != null).map((d) => d.score as number);

    const monthWorkedMinutes = monthDays.reduce((s, d) => s + d.workedMinutes, 0);
    const weekWorkedMinutes = weekDays.reduce((s, d) => s + d.workedMinutes, 0);
    const monthActivitiesCount = monthDays.reduce((s, d) => s + d.activityCount, 0);
    const monthActivitiesMinutes = activities
      .filter((a) => a.status === 'completed' && new Date(a.startedAt) >= monthStart)
      .reduce((s, a) => s + (a.durationMinutes || 0), 0);

    const monthAvg = avg(monthWorkScores);
    const weekAvg = avg(weekWorkScores);
    const stars = monthAvg != null ? Math.max(0, Math.min(5, Math.round(monthAvg / 20))) : 0;

    // Red / green marks (sobre los últimos 30 días)
    const redMarks = daily.filter((d) => d.score != null && (d.score as number) < 60).length;
    const greenMarks = daily.filter((d) => d.score === 100).length;
    const effectiveRedMarks = Math.max(0, redMarks - greenMarks);

    // Infracciones recientes (para mostrar al trabajador qué cumplir para recuperar)
    const recentInfractions = daily
      .filter((d) => d.score != null && (d.score as number) < 100)
      .slice(-7)
      .map((d) => {
        const reasons: string[] = [];
        if (!d.hasIn) reasons.push('No marcó entrada');
        if (!d.hasOut) reasons.push('No marcó salida');
        if (d.onTimeStatus === 'late') reasons.push('Tardanza');
        if (d.onTimeStatus === 'absent_threshold') reasons.push('Inasistencia (entrada muy tarde)');
        if (d.earlyLeave) reasons.push('Salida anticipada');
        if (d.activityCount === 0 && d.isWorkDay) reasons.push('Sin actividades registradas');
        return { date: d.date, score: d.score, reasons };
      })
      .filter((x) => x.reasons.length > 0);

    return {
      worker: { id: worker.id, name: worker.name, code: worker.code, photoUrl: worker.photoUrl },
      today: todayDay,
      week: {
        from: dateStr(weekStart),
        workedMinutes: weekWorkedMinutes,
        daysWorked: weekDays.filter((d) => d.workedMinutes > 0).length,
        avgScore: weekAvg,
      },
      month: {
        from: dateStr(monthStart),
        workedMinutes: monthWorkedMinutes,
        daysWorked: monthDays.filter((d) => d.workedMinutes > 0).length,
        avgScore: monthAvg,
        activitiesCount: monthActivitiesCount,
        activitiesMinutes: monthActivitiesMinutes,
      },
      stars,
      redMarks,
      greenMarks,
      effectiveRedMarks,
      recentInfractions,
      daily, // últimos 30 días (orden ascendente)
      scheduleEnabled: schedule.enabled,
    };
  }
}
