import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type AttendanceType = 'in' | 'out';
export type MatchStatus =
  | 'matched'
  | 'low_confidence'
  | 'unknown'
  | 'manual'
  | 'ai_unavailable';

@Entity('attendances')
@Index(['workerId', 'createdAt'])
export class Attendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Usuario (rol worker) que marcó. Null si fue un marcaje anónimo no identificado. */
  @Column('uuid', { nullable: true })
  workerId: string | null;

  @ManyToOne(() => User, (u) => u.attendances, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'workerId' })
  worker: User | null;

  /** 'in' = entrada, 'out' = salida */
  @Column({ type: 'varchar', length: 8 })
  type: AttendanceType;

  /** Foto capturada al momento de marcar */
  @Column({ type: 'text', default: '' })
  photoUrl: string;

  // --- Reconocimiento facial (IA) ---
  @Column({ type: 'varchar', length: 24, default: 'unknown' })
  matchStatus: MatchStatus;

  @Column({ default: '' })
  recognizedName: string;

  @Column({ type: 'float', default: 0 })
  confidence: number; // 0..100

  @Column({ type: 'text', default: '' })
  aiReasoning: string;

  /** Saludo generado por la IA (buenos días / buenas tardes) */
  @Column({ type: 'text', default: '' })
  greeting: string;

  // --- Ubicación ---
  @Column({ type: 'float', nullable: true })
  latitude: number | null;

  @Column({ type: 'float', nullable: true })
  longitude: number | null;

  @Column({ type: 'float', nullable: true })
  accuracy: number | null;

  @Column({ default: '' })
  locationLabel: string;

  @Column({ default: '' })
  deviceInfo: string;

  /** Fecha y hora del marcaje */
  @CreateDateColumn()
  createdAt: Date;
}
