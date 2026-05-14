import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Creación de un marcaje manualmente por un administrador / supervisor.
 * No pasa por reconocimiento facial; se etiqueta `matchStatus = 'manual'`.
 * El motivo es obligatorio para que quede registrado en la auditoría.
 */
export class CreateManualAttendanceDto {
  @IsUUID()
  workerId: string;

  @IsIn(['in', 'lunch_out', 'lunch_in', 'out'])
  type: 'in' | 'lunch_out' | 'lunch_in' | 'out';

  /** Fecha y hora del marcaje en ISO 8601. Si se omite, se usa la hora actual. */
  @IsOptional() @IsISO8601()
  createdAt?: string;

  /** Motivo / nota administrativa (obligatorio para audit). */
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(500)
  reason: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  locationLabel?: string;
}
