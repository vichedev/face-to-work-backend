import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, LessThan, Repository } from 'typeorm';
import { ReminderSent } from './reminder-sent.entity';
import { Attendance } from '../attendance/attendance.entity';
import { Activity } from '../activities/activity.entity';
import { User } from '../users/user.entity';
import { WorkScheduleService } from '../schedule/work-schedule.service';
import { PushService } from '../push/push.service';

function pad2(n: number) { return String(n).padStart(2, '0'); }
function dayStr(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

/** Duración máxima razonable de una actividad antes de avisar al trabajador (hora). */
const ACTIVITY_MAX_HOURS_DEFAULT = 4;

/**
 * Servicio de recordatorios programados. Cada cron consulta el estado actual,
 * decide a quién avisar, y registra en `reminder_sent` para no spamear.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('RemindersService');

  constructor(
    @InjectRepository(ReminderSent) private readonly sentRepo: Repository<ReminderSent>,
    @InjectRepository(Attendance) private readonly attRepo: Repository<Attendance>,
    @InjectRepository(Activity) private readonly actRepo: Repository<Activity>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly schedule: WorkScheduleService,
    private readonly push: PushService,
  ) {}

  /** Margen en minutos antes/después de la hora del turno antes de molestar. */
  private readonly GRACE_BEFORE_END = 30;     // 30 min después del end del turno → recuerda salida
  private readonly GRACE_AFTER_START = 30;    // 30 min después del start del turno → recuerda entrada
  private readonly LUNCH_RETURN_MIN = 90;     // 90 min en almuerzo sin volver → recuerda vuelta

  /** Devuelve `true` si ya se envió ese recordatorio hoy al trabajador. */
  private async alreadySent(workerId: string, kind: string, day: string): Promise<boolean> {
    const r = await this.sentRepo.findOne({ where: { workerId, day, kind } });
    return !!r;
  }
  private async markSent(workerId: string, kind: string, day: string) {
    await this.sentRepo.insert({ workerId, day, kind }).catch(() => {});
  }

  // ────────────────────────────────────────────────────────
  //  Recordatorios diarios sobre marcajes
  // ────────────────────────────────────────────────────────

  /**
   * Cada 30 min:
   *  - Si el trabajador ya pasó (start del turno + 30 min) y no ha marcado entrada → avisar.
   *  - Si terminó el turno + 30 min y entró pero no ha marcado salida → avisar.
   *  - Si está en almuerzo (lunch_out) hace ≥ 90 min y no marcó vuelta → avisar.
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'attendance-reminders' })
  async runAttendanceReminders() {
    try {
      const now = new Date();
      const today = dayStr(now);
      const schedule = await this.schedule.get();
      if (!schedule?.enabled) return;
      const dayCfg = (schedule.days || {})[String(now.getDay())] as any;
      if (!dayCfg?.enabled) return;
      const holiday = (schedule.holidays || []).find((h: any) => h.date === today);
      if (holiday) return;

      const [startH, startM] = String(dayCfg.start || '00:00').split(':').map(Number);
      const [endH, endM]     = String(dayCfg.end   || '00:00').split(':').map(Number);
      const shiftStart = new Date(now); shiftStart.setHours(startH || 0, startM || 0, 0, 0);
      const shiftEnd   = new Date(now); shiftEnd.setHours(endH   || 0, endM   || 0, 0, 0);
      const reminderInLimit  = new Date(shiftStart); reminderInLimit.setMinutes(reminderInLimit.getMinutes() + this.GRACE_AFTER_START);
      const reminderOutLimit = new Date(shiftEnd);   reminderOutLimit.setMinutes(reminderOutLimit.getMinutes() + this.GRACE_BEFORE_END);

      // Cargo marcajes de hoy + workers activos
      const todays = await this.attRepo.find({
        where: { createdAt: Between(startOfDay(now), endOfDay(now)) },
        relations: ['worker'],
        order: { createdAt: 'ASC' },
      });
      const workers = await this.usersRepo.find({ where: { role: 'worker', active: true } });

      const marksByWorker = new Map<string, typeof todays>();
      for (const m of todays) {
        if (!m.workerId) continue;
        if (!marksByWorker.has(m.workerId)) marksByWorker.set(m.workerId, []);
        marksByWorker.get(m.workerId)!.push(m);
      }

      for (const w of workers) {
        const list = marksByWorker.get(w.id) || [];
        const hasIn = list.some((m) => m.type === 'in');
        const last = list[list.length - 1];

        // 1. Falta la entrada
        if (!hasIn && now >= reminderInLimit) {
          if (!(await this.alreadySent(w.id, 'missing_clock_in', today))) {
            const r = await this.push.notifyUser(w.id, {
              title: 'Te falta marcar tu entrada',
              body: `Tu turno empezó a las ${dayCfg.start}. Marca tu entrada lo antes posible o pide una justificación.`,
              url: '/me',
              tag: 'missing-in-' + today,
            });
            await this.markSent(w.id, 'missing_clock_in', today);
            if (r.sent) this.log.log(`Recordatorio entrada → ${w.email}`);
          }
          continue; // si no marcó entrada, no aplicamos los demás recordatorios
        }

        // 2. Falta la salida (entrada existe, último marcaje no es 'out', pasó la hora)
        if (hasIn && last && last.type !== 'out' && now >= reminderOutLimit) {
          if (!(await this.alreadySent(w.id, 'missing_clock_out', today))) {
            const r = await this.push.notifyUser(w.id, {
              title: 'Te falta marcar tu salida',
              body: `Tu turno terminó a las ${dayCfg.end}. Marca tu salida cuando puedas o pide una justificación.`,
              url: '/me',
              tag: 'missing-out-' + today,
            });
            await this.markSent(w.id, 'missing_clock_out', today);
            if (r.sent) this.log.log(`Recordatorio salida → ${w.email}`);
          }
        }

        // 3. Falta vuelta de almuerzo
        const lunchOut = list.find((m) => m.type === 'lunch_out');
        const lunchIn  = list.find((m) => m.type === 'lunch_in');
        if (lunchOut && !lunchIn) {
          const since = now.getTime() - new Date(lunchOut.createdAt).getTime();
          const minsOut = Math.round(since / 60000);
          if (minsOut >= this.LUNCH_RETURN_MIN) {
            if (!(await this.alreadySent(w.id, 'missing_lunch_in', today))) {
              const r = await this.push.notifyUser(w.id, {
                title: 'Llevas mucho rato en almuerzo',
                body: `Saliste a almorzar hace ${minsOut} min. Marca tu vuelta cuando regreses al puesto.`,
                url: '/me',
                tag: 'missing-lunch-in-' + today,
              });
              await this.markSent(w.id, 'missing_lunch_in', today);
              if (r.sent) this.log.log(`Recordatorio vuelta almuerzo → ${w.email}`);
            }
          }
        }
      }
    } catch (e: any) {
      this.log.warn(`runAttendanceReminders falló: ${e?.message || e}`);
    }
  }

  // ────────────────────────────────────────────────────────
  //  Actividad excedida
  // ────────────────────────────────────────────────────────

  /**
   * Cada 15 minutos: busca actividades `in_progress` que llevan más horas
   * de las esperadas y avisa al trabajador (una sola vez por actividad).
   * Tambíen avisa al admin.
   */
  @Cron('*/15 * * * *', { name: 'activity-exceeded' })
  async runActivityExceeded() {
    try {
      const now = new Date();
      const maxMs = ACTIVITY_MAX_HOURS_DEFAULT * 3600 * 1000;
      const cutoff = new Date(now.getTime() - maxMs);

      // Actividades que empezaron antes del cutoff y siguen `in_progress`
      const stale = await this.actRepo.find({
        where: { status: 'in_progress', startedAt: LessThan(cutoff), endedAt: IsNull() },
        relations: ['worker'],
      });
      if (!stale.length) return;

      for (const a of stale) {
        // Usamos la propia id de actividad como `day` para que no se repita.
        const key = `act-${a.id}`;
        if (await this.alreadySent(a.workerId, 'activity_exceeded', key)) continue;

        const mins = Math.round((now.getTime() - new Date(a.startedAt).getTime()) / 60000);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const dur = h ? `${h} h ${m} min` : `${m} min`;

        // Avisar al trabajador
        await this.push.notifyUser(a.workerId, {
          title: 'Actividad excedida',
          body: `"${a.title}" lleva ${dur} en curso. ¿La quieres terminar?`,
          url: '/me',
          tag: 'act-exceeded-' + a.id,
        });
        // Avisar al admin
        await this.push.notifyAdmins({
          title: 'Actividad excedida',
          body: `${a.worker?.name || 'Trabajador'} lleva ${dur} en "${a.title}"`,
          url: '/admin/activities',
          tag: 'act-exceeded-admin-' + a.id,
          icon: a.worker?.photoUrl || undefined,
        });
        await this.markSent(a.workerId, 'activity_exceeded', key);
        this.log.log(`Actividad excedida ${a.id} (${a.worker?.email || '?'}, ${dur})`);
      }
    } catch (e: any) {
      this.log.warn(`runActivityExceeded falló: ${e?.message || e}`);
    }
  }

  /** Limpia entradas viejas (> 60 días) para que la tabla no crezca infinitamente. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'reminder-cleanup' })
  async cleanup() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    await this.sentRepo
      .createQueryBuilder()
      .delete()
      .where('"createdAt" < :c', { c: cutoff })
      .execute()
      .catch(() => {});
  }
}
