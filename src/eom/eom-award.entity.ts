import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Premio "Empleado del mes": el admin marca a un trabajador como ganador de un mes
 * y le adjudica una recompensa (texto + emoji + mensaje). Único por (year, month).
 */
@Entity('eom_awards')
@Unique(['year', 'month'])
@Index(['workerId'])
export class EmployeeOfMonthAward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  year: number;

  /** 1..12 */
  @Column({ type: 'int' })
  month: number;

  @Column('uuid')
  workerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workerId' })
  worker: User;

  /** Texto corto que identifica el premio (ej. "Seco de Marujita"). */
  @Column({ type: 'varchar', length: 120 })
  rewardLabel: string;

  /** Emoji visual del premio (un caracter). */
  @Column({ type: 'varchar', length: 16, default: '🏆' })
  rewardEmoji: string;

  /** Descripción / detalle (ej. "Almuerzo invitado el viernes 14 al mediodía"). */
  @Column({ type: 'text', default: '' })
  rewardDescription: string;

  /** Mensaje personalizado del admin al ganador. */
  @Column({ type: 'text', default: '' })
  message: string;

  /** Score numérico (0..100) con el que fue elegido. Histórico. */
  @Column({ type: 'float', default: 0 })
  score: number;

  @Column('uuid', { nullable: true })
  awardedById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
