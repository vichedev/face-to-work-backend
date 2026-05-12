import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateWorkerDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(120)
  fullName: string;

  @Transform(lower)
  @IsEmail({}, { message: 'Correo electrónico inválido' })
  @MaxLength(120)
  email: string;

  @IsString()
  @MinLength(4, { message: 'La contraseña debe tener al menos 4 caracteres' })
  @MaxLength(128)
  password: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  position?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  department?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  phone?: string;

  /** Foto de referencia como data URL base64 (data:image/jpeg;base64,...) */
  @IsOptional() @IsString()
  photoBase64?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;
}
