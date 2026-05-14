import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Attendance } from '../attendance/attendance.entity';

/**
 * - `admin`: super-administrador. Acceso total: jornada, marca, audit, seguridad, crear otros admins.
 * - `supervisor`: solo lectura + aprobar/rechazar justificaciones + crear tareas. No edita jornada,
 *   marca, audit, ni administra otros admins.
 * - `worker`: marca su propia asistencia, ve su panel.
 */
export type UserRole = 'admin' | 'supervisor' | 'worker';

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

  /**
   * Notas internas del staff sobre el trabajador (alergias, contacto de emergencia,
   * observaciones administrativas, etc.). Sólo visibles para admin/supervisor — el
   * trabajador nunca ve este campo. Limite suave aplicado en el DTO (4000 chars).
   */
  @Column({ type: 'text', default: '' })
  internalNotes: string;

  // --- 2FA (TOTP, compatible con Google/Microsoft Authenticator) ---
  /** Secreto base32 generado al activar 2FA. `select: false`: no se devuelve nunca, salvo consulta explícita. */
  @Column({ type: 'varchar', length: 64, default: '', select: false })
  totpSecret: string;

  @Column({ default: false })
  totpEnabled: boolean;

  /**
   * Versión del token JWT. Cada vez que se rota (cambio de contraseña, "cerrar
   * todas las sesiones") se incrementa, lo que invalida cualquier JWT emitido
   * con la versión anterior. El JwtStrategy compara este valor con el del payload.
   */
  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  /**
   * Si es true, al iniciar sesión el frontend obliga al usuario a fijar una nueva
   * contraseña antes de poder usar la app. Se activa cuando el admin crea la cuenta
   * o resetea la contraseña. Se desactiva al cambiarla con éxito.
   */
  @Column({ default: false })
  mustChangePassword: boolean;

  @OneToMany(() => Attendance, (a) => a.worker)
  attendances: Attendance[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
