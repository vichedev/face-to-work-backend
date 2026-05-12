import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Marcaje desde el panel del trabajador autenticado. */
export class MarkDto {
  /** Foto capturada como data URL base64 */
  @IsString()
  photoBase64: string;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;

  @IsOptional() @IsNumber() @Min(0)
  accuracy?: number;

  @IsOptional() @IsString() @MaxLength(200)
  locationLabel?: string;

  @IsOptional() @IsString() @MaxLength(220)
  deviceInfo?: string;

  /** Normalmente se omite: el sistema alterna entrada/salida automáticamente */
  @IsOptional() @IsIn(['in', 'out'])
  type?: 'in' | 'out';
}
