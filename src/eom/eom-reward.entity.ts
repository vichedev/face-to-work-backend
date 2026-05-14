import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Catálogo de recompensas disponibles que el admin define una vez y reutiliza
 * al asignar "Empleado del mes". Cada empresa tiene las suyas (Seco de chivo,
 * cerveza, bono $50, día libre, etc.). Se ordena por `sortOrder` ASC.
 */
@Entity('eom_rewards')
@Index(['active', 'sortOrder'])
export class EomReward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, default: '🏆' })
  emoji: string;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({ type: 'text', default: '' })
  description: string;

  /** Orden de aparición en el catálogo (menor primero). */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  /** Si false, no aparece como opción al asignar premios pero se conserva en historial. */
  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
