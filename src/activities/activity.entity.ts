import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type ActivityStatus = 'in_progress' | 'completed' | 'cancelled';

@Entity('activities')
@Index(['workerId', 'startedAt'])
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workerId' })
  worker: User;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  // --- Inicio ---
  @Column({ type: 'float', nullable: true })
  startLatitude: number | null;

  @Column({ type: 'float', nullable: true })
  startLongitude: number | null;

  @Column({ type: 'float', nullable: true })
  startAccuracy: number | null;

  @Column({ default: '' })
  startLocationLabel: string;

  @CreateDateColumn()
  startedAt: Date;

  // --- Fin ---
  @Column({ type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'text', default: '' })
  completionNote: string;

  @Column({ type: 'float', nullable: true })
  endLatitude: number | null;

  @Column({ type: 'float', nullable: true })
  endLongitude: number | null;

  @Column({ type: 'float', nullable: true })
  endAccuracy: number | null;

  @Column({ default: '' })
  endLocationLabel: string;

  @Column({ type: 'int', default: 0 })
  durationMinutes: number;

  @Column({ type: 'varchar', length: 16, default: 'in_progress' })
  status: ActivityStatus;

  @UpdateDateColumn()
  updatedAt: Date;
}
