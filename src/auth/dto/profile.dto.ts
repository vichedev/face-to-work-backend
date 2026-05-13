import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  phone?: string;

  /** Foto en data URL base64 (opcional). Si viene reemplaza la foto del usuario. */
  @IsOptional() @IsString()
  photoBase64?: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(6)
  currentPassword: string;

  @IsString() @MinLength(8) @MaxLength(128)
  newPassword: string;
}
