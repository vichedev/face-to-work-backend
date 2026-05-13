import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Bitácora de recordatorios enviados — evita spamear al trabajador con la misma
 * notificación varias veces al día. Llave única: (workerId, day, kind).
 */
@Entity('reminder_sent')
@Unique(['workerId', 'day', 'kind'])
@Index(['day'])
export class ReminderSent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workerId: string;

  /** 'YYYY-MM-DD' local. */
  @Column({ type: 'date' })
  day: string;

  /** 'missing_clock_out' | 'overdue_task' | … (ampliable). */
  @Column({ type: 'varchar', length: 32 })
  kind: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
