import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Attendance } from '../attendance/attendance.entity';

export type UserRole = 'admin' | 'worker';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  /** Hash bcrypt. `select: false`: no se devuelve en las consultas salvo que se pida explícitamente. */
  @Column({ select: false })
  password: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 12, default: 'worker' })
  role: UserRole;

  // --- Datos de trabajador (vacíos / null para administradores) ---

  /** Cédula / código de empleado */
  @Column({ type: 'varchar', length: 40, nullable: true, unique: true })
  code: string | null;

  /** Cargo / puesto */
  @Column({ default: '' })
  position: string;

  /** Área / departamento */
  @Column({ default: '' })
  department: string;

  @Column({ default: '' })
  phone: string;

  /** URL de la foto de referencia (rostro) */
  @Column({ type: 'text', default: '' })
  photoUrl: string;

  /** Descriptor facial estructurado generado por la IA (Groq) */
  @Column({ type: 'jsonb', nullable: true })
  faceDescriptor: Record<string, any> | null;

  /** Si está activo puede iniciar sesión y marcar */
  @Column({ default: true })
  active: boolean;

  // --- 2FA (TOTP, compatible con Google/Microsoft Authenticator) ---
  /** Secreto base32 generado al activar 2FA. `select: false`: no se devuelve nunca, salvo consulta explícita. */
  @Column({ type: 'varchar', length: 64, default: '', select: false })
  totpSecret: string;

  @Column({ default: false })
  totpEnabled: boolean;

  @OneToMany(() => Attendance, (a) => a.worker)
  attendances: Attendance[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
