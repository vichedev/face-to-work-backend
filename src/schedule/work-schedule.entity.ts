import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Config de un día de la semana (clave "0"=domingo … "6"=sábado). */
export interface DaySchedule {
  enabled: boolean;
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export interface Holiday {
  date: string; // "YYYY-MM-DD"
  name: string;
}

/**
 * Configuración (única) de la jornada laboral. La maneja el administrador.
 * Si `enabled` es false, los marcajes se registran sin evaluar nada (estado "normal").
 */
@Entity('work_schedule')
export class WorkSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'Jornada laboral' })
  name: string;

  /** Interruptor general: si false no se evalúa la jornada (sólo se registran horas). */
  @Column({ default: false })
  enabled: boolean;

  /** Config por día de la semana: { "0": {enabled,start,end}, ... "6": {...} } */
  @Column({ type: 'jsonb', nullable: true })
  days: Record<string, DaySchedule> | null;

  /** Minutos tras la hora de entrada para empezar a contar tardanza. */
  @Column({ type: 'int', default: 5 })
  lateAfterMinutes: number;

  /** Minutos tras la hora de entrada a partir de los cuales la tardanza cuenta como inasistencia. */
  @Column({ type: 'int', default: 120 })
  absentAfterMinutes: number;

  /** Si se contabilizan las horas extra. */
  @Column({ default: false })
  overtimeEnabled: boolean;

  /** Minutos que deben pasar tras la hora de salida para que cuente como hora extra. */
  @Column({ type: 'int', default: 0 })
  overtimeAfterMinutes: number;

  /** Si se contabiliza la salida anticipada. */
  @Column({ default: false })
  earlyLeaveEnabled: boolean;

  /** Minutos antes de la hora de salida a partir de los cuales cuenta como salida anticipada. */
  @Column({ type: 'int', default: 5 })
  earlyLeaveBeforeMinutes: number;

  /** Días festivos / no laborables (además de los días de descanso semanales). */
  @Column({ type: 'jsonb', nullable: true })
  holidays: Holiday[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
