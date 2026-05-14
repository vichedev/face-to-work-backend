import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeOfMonthAward } from './eom-award.entity';
import { User } from '../users/user.entity';
import { PayrollService } from '../payroll/payroll.service';
import { PushService } from '../push/push.service';

export interface EomRankingItem {
  worker: { id: string; name: string; code: string | null; photoUrl: string; position: string; department: string };
  score: number;
  // KPIs que el frontend muestra como destacados
  workedDays: number;
  workedHours: number;
  overtimeHours: number;
  lateDays: number;
  absentDays: number;
  activitiesCount: number;
  // Subscores opcionales
  attendanceRate: number; // 0..1
  punctualityRate: number; // 0..1
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

@Injectable()
export class EomService {
  constructor(
    @InjectRepository(EmployeeOfMonthAward) private readonly repo: Repository<EmployeeOfMonthAward>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly payroll: PayrollService,
    private readonly push: PushService,
  ) {}

  /**
   * Ranking de trabajadores de un mes. Combina:
   *  · asistencia (35%)
   *  · puntualidad (30%)
   *  · productividad por actividades (20%)
   *  · horas extra / esfuerzo adicional (15%)
   * Score final 0..100. Mínimo 5 días trabajados para entrar al ranking.
   */
  async ranking(year: number, month: number, limit = 10): Promise<EomRankingItem[]> {
    const workers = await this.usersRepo.find({
      where: { role: 'worker', active: true },
      order: { name: 'ASC' },
    });

    const items: EomRankingItem[] = [];
    for (const w of workers) {
      try {
        const p = await this.payroll.computeMonth(w.id, year, month);
        const t = p.totals;
        if (t.workedDays < 5) continue; // Filtro de elegibilidad
        const expected = Math.max(t.workDays, 1);
        const attendanceRate = Math.min(1, (t.workedDays + t.justifiedDays * 0.5) / expected);
        const punctualityRate = t.workedDays > 0 ? Math.max(0, 1 - (t.lateDays / t.workedDays)) : 0;
        const activityScore = Math.min(1, t.activitiesCount / 15); // 15+ acts = max
        const overtimeScore = Math.min(1, t.overtimeMinutes / 600); // 10 h extras al mes = max

        const score =
          attendanceRate * 35 +
          punctualityRate * 30 +
          activityScore * 20 +
          overtimeScore * 15;

        items.push({
          worker: {
            id: w.id,
            name: w.name,
            code: w.code,
            photoUrl: w.photoUrl,
            position: w.position,
            department: w.department,
          },
          score: Math.round(score * 10) / 10,
          workedDays: t.workedDays,
          workedHours: Math.round((t.workedMinutes / 60) * 10) / 10,
          overtimeHours: Math.round((t.overtimeMinutes / 60) * 10) / 10,
          lateDays: t.lateDays,
          absentDays: t.absentDays,
          activitiesCount: t.activitiesCount,
          attendanceRate: Math.round(attendanceRate * 1000) / 1000,
          punctualityRate: Math.round(punctualityRate * 1000) / 1000,
        });
      } catch {
        // worker sin datos suficientes — saltar
      }
    }
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, limit);
  }

  /** Devuelve el award guardado para ese mes (o null). */
  async getAward(year: number, month: number) {
    return this.repo.findOne({ where: { year, month }, relations: ['worker'] });
  }

  /** Award del mes actual + ranking. Incluye el award si ya fue asignado. */
  async currentMonthSummary(limit = 5) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const [ranking, award] = await Promise.all([
      this.ranking(year, month, limit),
      this.getAward(year, month),
    ]);
    return { year, month, ranking, award };
  }

  async setAward(
    year: number,
    month: number,
    workerId: string,
    data: { rewardLabel: string; rewardEmoji?: string; rewardDescription?: string; message?: string },
    awardedById: string,
  ): Promise<EmployeeOfMonthAward> {
    if (!data.rewardLabel?.trim()) throw new BadRequestException('Indica el nombre de la recompensa');
    const worker = await this.usersRepo.findOne({ where: { id: workerId, role: 'worker', active: true } });
    if (!worker) throw new BadRequestException('Trabajador inválido');

    // Buscamos el score del trabajador en el ranking del mes (puede ser que el admin lo asigne aunque no esté top 1)
    const ranking = await this.ranking(year, month, 100);
    const inRanking = ranking.find((r) => r.worker.id === workerId);
    const score = inRanking?.score || 0;

    const existing = await this.repo.findOne({ where: { year, month } });
    const payload: Partial<EmployeeOfMonthAward> = {
      year,
      month,
      workerId,
      rewardLabel: data.rewardLabel.trim().slice(0, 120),
      rewardEmoji: (data.rewardEmoji || '🏆').slice(0, 16),
      rewardDescription: (data.rewardDescription || '').trim().slice(0, 2000),
      message: (data.message || '').trim().slice(0, 2000),
      score,
      awardedById,
    };
    let saved: EmployeeOfMonthAward;
    if (existing) {
      Object.assign(existing, payload);
      saved = await this.repo.save(existing);
    } else {
      saved = await this.repo.save(this.repo.create(payload));
    }

    // Notificar al ganador
    const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });
    this.push.notifyUser(workerId, {
      title: `🏆 ¡Eres el empleado del mes!`,
      body: `${monthLabel}: ${payload.rewardEmoji} ${payload.rewardLabel}${payload.message ? ' — ' + String(payload.message).slice(0, 120) : ''}`,
      url: '/me',
      tag: `eom-${year}-${pad2(month)}`,
      icon: worker.photoUrl || undefined,
    }).catch(() => {});

    return saved;
  }

  async removeAward(year: number, month: number) {
    const found = await this.repo.findOne({ where: { year, month } });
    if (!found) throw new NotFoundException('No hay premio asignado para ese mes');
    await this.repo.remove(found);
    return { ok: true };
  }

  /** Historial completo de premios (todos los meses pasados), recientes primero. */
  async history(limit = 60) {
    const items = await this.repo.find({
      relations: ['worker'],
      order: { year: 'DESC', month: 'DESC' },
      take: limit,
    });
    return items;
  }

  /** Premios del trabajador autenticado (vista del worker en su panel). */
  async forWorker(workerId: string) {
    return this.repo.find({
      where: { workerId },
      order: { year: 'DESC', month: 'DESC' },
    });
  }
}
