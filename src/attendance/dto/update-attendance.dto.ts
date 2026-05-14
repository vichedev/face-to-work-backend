import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Corrección de un marcaje por parte de un administrador. */
export class UpdateAttendanceDto {
  @IsOptional()
  @IsIn(['in', 'lunch_out', 'lunch_in', 'out'])
  type?: 'in' | 'lunch_out' | 'lunch_in' | 'out';

  @IsOptional()
  @IsISO8601()
  createdAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationLabel?: string;

  /** Motivo de la corrección. Si llega, se incluye en el audit log. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
