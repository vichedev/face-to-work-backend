import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/** Corrección de un marcaje por parte de un administrador. */
export class UpdateAttendanceDto {
  @IsOptional()
  @IsIn(['in', 'out'])
  type?: 'in' | 'out';

  @IsOptional()
  @IsISO8601()
  createdAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationLabel?: string;
}
