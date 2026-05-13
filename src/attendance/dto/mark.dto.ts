import {
  IsIn,
  IsInt,
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

  /** Hora local del dispositivo del trabajador (0-23). Se usa para el saludo. */
  @IsOptional() @IsInt() @Min(0) @Max(23)
  clientHour?: number;

  /** Normalmente se omite: el sistema determina el siguiente tipo automáticamente.
   *  Secuencia: in → lunch_out → lunch_in → out  (lunch puede saltarse) */
  @IsOptional() @IsIn(['in', 'lunch_out', 'lunch_in', 'out'])
  type?: 'in' | 'lunch_out' | 'lunch_in' | 'out';

  /** % de diferencia entre dos frames capturados con ~1 s de separación. Si viene < umbral, el marcaje se acepta pero se etiqueta como "sin verificar liveness". */
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  livenessScore?: number;
}
