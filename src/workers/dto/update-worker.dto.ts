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

export class UpdateWorkerDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  fullName?: string;

  @IsOptional() @Transform(lower) @IsEmail() @MaxLength(120)
  email?: string;

  /** Si viene, se cambia la contraseña del trabajador */
  @IsOptional() @IsString() @MinLength(4) @MaxLength(128)
  password?: string;

  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(40)
  code?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  position?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  department?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  phone?: string;

  /** Nueva foto de referencia base64 (regenera el descriptor facial) */
  @IsOptional() @IsString()
  photoBase64?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;

  /** Notas internas (sólo visibles para staff). */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000)
  internalNotes?: string;
}
