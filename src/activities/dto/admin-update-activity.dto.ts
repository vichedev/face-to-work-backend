import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

/** Corrección/edición de una actividad por parte del administrador. */
export class AdminUpdateActivityDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  title?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  completionNote?: string;

  @IsOptional() @IsISO8601()
  startedAt?: string;

  @IsOptional() @IsISO8601()
  endedAt?: string;

  @IsOptional() @IsIn(['in_progress', 'completed', 'cancelled'])
  status?: 'in_progress' | 'completed' | 'cancelled';
}
