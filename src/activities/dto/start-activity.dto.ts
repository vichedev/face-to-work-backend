import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

export class StartActivityDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;

  @IsOptional() @IsNumber() @Min(0)
  accuracy?: number;

  @IsOptional() @IsString() @MaxLength(160)
  locationLabel?: string;
}
