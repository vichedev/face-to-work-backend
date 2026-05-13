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

export type AttendanceType = 'in' | 'lunch_out' | 'lunch_in' | 'out';
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

  /** Tipo de marcaje: in (entrada), lunch_out (salida a almuerzo), lunch_in (vuelta), out (salida del trabajo). */
  @Column({ type: 'text' })
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

  // --- Evaluación de la jornada laboral (según la config vigente al marcar) ---
  // '' | 'normal' | 'on_time' | 'late' | 'absent_threshold' | 'overtime' | 'early_leave' | 'rest_day' | 'holiday'
  @Column({ type: 'varchar', length: 24, default: '' })
  scheduleStatus: string;

  /** Minutos de tardanza / hora extra / salida anticipada según el estado. */
  @Column({ type: 'int', default: 0 })
  scheduleMinutes: number;

  @Column({ type: 'text', default: '' })
  scheduleNote: string;

  // --- Ubicación ---
  @Column({ type: 'float', nullable: true })
  latitude: number | null;

  @Column({ type: 'float', nullable: true })
  longitude: number | null;

  @Column({ type: 'float', nullable: true })
  accuracy: number | null;

  @Column({ default: '' })
  locationLabel: string;

  /** Distancia (m) entre el marcaje y la oficina configurada (null si no hay oficina). */
  @Column({ type: 'float', nullable: true })
  distanceFromOfficeMeters: number | null;

  /** True si está dentro del radio de la oficina (false si fuera o si no hay geocerca activa). */
  @Column({ default: false })
  insideOffice: boolean;

  @Column({ default: '' })
  deviceInfo: string;

  // --- Liveness (anti-fraude: detecta fotos impresas) ---
  /** % de diferencia entre dos frames capturados con ~1 s de separación. >= 2.5 ⇒ persona real. */
  @Column({ type: 'float', nullable: true })
  livenessScore: number | null;

  /** True si pasó la verificación de "vida" (score sobre el umbral). False si vino de "Subir foto" o frames idénticos. */
  @Column({ default: false })
  livenessVerified: boolean;

  /** Fecha y hora del marcaje (timestamptz: el almacenado siempre es UTC, el cliente lo formatea a su zona). */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
