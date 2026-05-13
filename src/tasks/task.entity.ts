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

export type TaskStatus =
  | 'pending'       // creada, pendiente de aceptar
  | 'accepted'      // el trabajador la aceptó pero todavía no la inicia
  | 'in_progress'   // el trabajador la está ejecutando (con Activity vinculada)
  | 'completed'     // terminada
  | 'cancelled';    // admin la canceló

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Tarea asignada por un administrador a un trabajador específico.
 * Al iniciarla se crea automáticamente una Activity vinculada (`activityId`).
 */
@Entity('tasks')
@Index(['workerId', 'status'])
@Index(['workerId', 'dueAt'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workerId' })
  worker: User;

  @Column('uuid')
  assignedById: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignedById' })
  assignedBy: User;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 12, default: 'normal' })
  priority: TaskPriority;

  /** Fecha/hora límite (opcional). */
  @Column({ type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  // Ubicación esperada del trabajo (opcional)
  @Column({ default: '' })
  locationLabel: string;

  @Column({ type: 'float', nullable: true })
  locationLat: number | null;

  @Column({ type: 'float', nullable: true })
  locationLng: number | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: TaskStatus;

  /** Si la tarea se inició, link a la Activity creada (no es FK estricta para no acoplar). */
  @Column('uuid', { nullable: true })
  activityId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
