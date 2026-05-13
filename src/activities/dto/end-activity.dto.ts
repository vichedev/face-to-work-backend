import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

export class EndActivityDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  completionNote?: string;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;

  @IsOptional() @IsNumber() @Min(0)
  accuracy?: number;

  @IsOptional() @IsString() @MaxLength(160)
  locationLabel?: string;

  /** Foto base64 opcional (data URL o sólo base64). Evidencia del resultado. */
  @IsOptional() @IsString()
  photoBase64?: string;
}
