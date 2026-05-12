import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DaySchedule,
  Holiday,
  WorkSchedule,
} from './work-schedule.entity';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

export type MarkType = 'in' | 'out';
export type ScheduleStatus =
  | 'normal' // jornada no evaluada (deshabilitada)
  | 'on_time' // dentro de lo esperado
  | 'late' // tardanza
  | 'absent_threshold' // tan tarde que supera el límite -> cuenta como inasistencia
  | 'overtime' // hora extra
  | 'early_leave' // salida anticipada
  | 'rest_day' // marcó en un día de descanso
  | 'holiday'; // marcó en un día festivo

export interface ScheduleEval {
  status: ScheduleStatus;
  minutes: number; // minutos de tardanza / hora extra / salida anticipada (según el estado)
  note: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseTimeOnDate(base: Date, hhmm: string): Date {
  const [h, m] = (HHMM.test(hhmm) ? hhmm : '00:00').split(':').map((x) => parseInt(x, 10));
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}
function fmtDur(min: number): string {
  const m = Math.abs(Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
function defaultDays(): Record<string, DaySchedule> {
  const day = (enabled: boolean, start = '08:00', end = '17:00'): DaySchedule => ({ enabled, start, end });
  return {
    '0': day(false), // domingo
    '1': day(true), // lunes
    '2': day(true),
    '3': day(true),
    '4': day(true),
    '5': day(true), // viernes
    '6': day(false, '08:00', '13:00'), // sábado
  };
}
function sanitizeDays(input: any, current: Record<string, DaySchedule>): Record<string, DaySchedule> {
  const out: Record<string, DaySchedule> = { ...current };
  if (input && typeof input === 'object') {
    for (let i = 0; i <= 6; i++) {
      const k = String(i);
      const v = input[k];
      if (v && typeof v === 'object') {
        out[k] = {
          enabled: v.enabled === true || v.enabled === 'true',
          start: HHMM.test(v.start) ? v.start : out[k]?.start || '08:00',
          end: HHMM.test(v.end) ? v.end : out[k]?.end || '17:00',
        };
      }
    }
  }
  return out;
}
function sanitizeHolidays(input: any): Holiday[] {
  if (!Array.isArray(input)) return [];
  const map = new Map<string, string>();
  for (const h of input) {
    if (h && typeof h === 'object' && YMD.test(h.date)) {
      map.set(h.date, String(h.name || '').slice(0, 80).trim());
    }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, name]) => ({ date, name }));
}
function clampMin(v: any, def: number): number {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 0) return def;
  return Math.min(n, 1440);
}

@Injectable()
export class WorkScheduleService {
  constructor(
    @InjectRepository(WorkSchedule) private readonly repo: Repository<WorkSchedule>,
  ) {}

  /** Devuelve la (única) configuración, creando los valores por defecto si no existe. */
  async get(): Promise<WorkSchedule> {
    const list = await this.repo.find({ order: { createdAt: 'ASC' }, take: 1 });
    if (list.length) {
      const s = list[0];
      if (!s.days) s.days = defaultDays();
      if (!s.holidays) s.holidays = [];
      return s;
    }
    const created = this.repo.create({
      name: 'Jornada laboral',
      enabled: false,
      days: defaultDays(),
      lateAfterMinutes: 5,
      absentAfterMinutes: 120,
      overtimeEnabled: false,
      overtimeAfterMinutes: 0,
      earlyLeaveEnabled: false,
      earlyLeaveBeforeMinutes: 5,
      holidays: [],
    });
    return this.repo.save(created);
  }

  async update(dto: UpdateScheduleDto): Promise<WorkSchedule> {
    const s = await this.get();
    if (dto.name !== undefined) s.name = String(dto.name).slice(0, 80).trim() || 'Jornada laboral';
    if (dto.enabled !== undefined) s.enabled = !!dto.enabled;
    if (dto.days !== undefined) s.days = sanitizeDays(dto.days, s.days || defaultDays());
    if (dto.lateAfterMinutes !== undefined) s.lateAfterMinutes = clampMin(dto.lateAfterMinutes, s.lateAfterMinutes);
    if (dto.absentAfterMinutes !== undefined) s.absentAfterMinutes = clampMin(dto.absentAfterMinutes, s.absentAfterMinutes);
    if (dto.overtimeEnabled !== undefined) s.overtimeEnabled = !!dto.overtimeEnabled;
    if (dto.overtimeAfterMinutes !== undefined) s.overtimeAfterMinutes = clampMin(dto.overtimeAfterMinutes, s.overtimeAfterMinutes);
    if (dto.earlyLeaveEnabled !== undefined) s.earlyLeaveEnabled = !!dto.earlyLeaveEnabled;
    if (dto.earlyLeaveBeforeMinutes !== undefined) s.earlyLeaveBeforeMinutes = clampMin(dto.earlyLeaveBeforeMinutes, s.earlyLeaveBeforeMinutes);
    if (dto.holidays !== undefined) s.holidays = sanitizeHolidays(dto.holidays);
    // coherencia: el límite de inasistencia no puede ser menor que el de tardanza
    if (s.absentAfterMinutes < s.lateAfterMinutes) s.absentAfterMinutes = s.lateAfterMinutes;
    return this.repo.save(s);
  }

  /**
   * Evalúa un marcaje contra la jornada configurada.
   * @param isFirstInOfDay sólo el primer "in" del día se evalúa para tardanza; los reingresos quedan "normal".
   */
  evaluate(opts: { type: MarkType; at: Date; schedule: WorkSchedule; isFirstInOfDay: boolean }): ScheduleEval {
    const { type, at, schedule, isFirstInOfDay } = opts;
    if (!schedule || !schedule.enabled) return { status: 'normal', minutes: 0, note: '' };

    const ds = dateStr(at);
    const holiday = (schedule.holidays || []).find((h) => h.date === ds);
    if (holiday) {
      return { status: 'holiday', minutes: 0, note: `Día festivo${holiday.name ? ': ' + holiday.name : ''}` };
    }

    const days = schedule.days || defaultDays();
    const day = days[String(at.getDay())];
    if (!day || !day.enabled) return { status: 'rest_day', minutes: 0, note: 'Marcaje en día de descanso' };

    if (type === 'in') {
      if (!isFirstInOfDay) return { status: 'normal', minutes: 0, note: 'Reingreso' };
      const start = parseTimeOnDate(at, day.start);
      const lateMin = Math.round((at.getTime() - start.getTime()) / 60000);
      if (lateMin > schedule.absentAfterMinutes) {
        return { status: 'absent_threshold', minutes: lateMin, note: `Entrada con ${fmtDur(lateMin)} de retraso — supera el límite, cuenta como inasistencia` };
      }
      if (lateMin > schedule.lateAfterMinutes) {
        return { status: 'late', minutes: lateMin, note: `Llegó ${fmtDur(lateMin)} tarde (esperado ${day.start})` };
      }
      if (lateMin < -1) return { status: 'on_time', minutes: 0, note: `A tiempo (llegó ${fmtDur(-lateMin)} antes)` };
      return { status: 'on_time', minutes: 0, note: 'A tiempo' };
    }

    // type === 'out'
    const end = parseTimeOnDate(at, day.end);
    const delta = Math.round((at.getTime() - end.getTime()) / 60000); // + = después de la hora de salida
    if (delta >= 0) {
      if (schedule.overtimeEnabled && delta > 0 && delta >= schedule.overtimeAfterMinutes) {
        return { status: 'overtime', minutes: delta, note: `${fmtDur(delta)} de horas extra (salida ${day.end})` };
      }
      return { status: 'on_time', minutes: 0, note: delta > 0 ? `Salida ${fmtDur(delta)} después de la hora` : 'Salida puntual' };
    }
    const early = -delta;
    if (schedule.earlyLeaveEnabled && early > schedule.earlyLeaveBeforeMinutes) {
      return { status: 'early_leave', minutes: early, note: `Salió ${fmtDur(early)} antes (esperado ${day.end})` };
    }
    return { status: 'on_time', minutes: 0, note: 'Salida' };
  }
}
