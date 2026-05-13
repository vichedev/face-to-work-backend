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

export type JustificationType =
  | 'tardanza'
  | 'ausencia'
  | 'permiso'
  | 'medico'
  | 'otro';

export type JustificationStatus = 'pending' | 'approved' | 'rejected';

/**
 * Justificación que el trabajador envía para una tardanza, ausencia o permiso.
 * El admin la aprueba o rechaza. Las aprobadas pueden "limpiar" el estado de
 * jornada (lo aplica el panel admin al revisar el marcaje correspondiente).
 */
@Entity('justifications')
@Index(['workerId', 'dateFrom'])
export class Justification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workerId' })
  worker: User;

  /** Rango cubierto por la justificación (puede ser un solo día). */
  @Column({ type: 'date' })
  dateFrom: string; // 'YYYY-MM-DD'

  @Column({ type: 'date' })
  dateTo: string; // 'YYYY-MM-DD'

  @Column({ type: 'varchar', length: 16, default: 'otro' })
  type: JustificationType;

  @Column({ type: 'text' })
  reason: string;

  /** Documento adjunto opcional (PDF/imagen). */
  @Column({ type: 'text', default: '' })
  attachmentUrl: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: JustificationStatus;

  /** Comentario del admin al aprobar/rechazar. */
  @Column({ type: 'text', default: '' })
  adminNote: string;

  /** Admin que decidió. */
  @Column('uuid', { nullable: true })
  decidedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
