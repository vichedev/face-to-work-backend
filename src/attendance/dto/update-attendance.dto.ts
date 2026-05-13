import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
