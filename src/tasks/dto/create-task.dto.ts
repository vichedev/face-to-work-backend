import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTaskDto {
  @IsUUID()
  workerId: string;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(140)
  title: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  @IsOptional() @IsISO8601()
  dueAt?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  locationLabel?: string;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  locationLat?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  locationLng?: number;
}

export class UpdateTaskDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(140)
  title?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  @IsOptional() @IsISO8601()
  dueAt?: string | null;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  locationLabel?: string;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  locationLat?: number | null;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  locationLng?: number | null;

  @IsOptional() @IsIn(['pending', 'accepted', 'in_progress', 'completed', 'cancelled'])
  status?: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
}
