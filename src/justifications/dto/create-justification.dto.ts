import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

export class CreateJustificationDto {
  @IsISO8601()
  dateFrom: string;

  @IsISO8601()
  dateTo: string;

  @IsIn(['tardanza', 'ausencia', 'permiso', 'medico', 'otro'])
  type: 'tardanza' | 'ausencia' | 'permiso' | 'medico' | 'otro';

  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1500)
  reason: string;

  /** Adjunto opcional como data URL base64 (PDF o imagen). */
  @IsOptional() @IsString()
  attachmentBase64?: string;

  /** Nombre original del archivo (para preservar extensión). */
  @IsOptional() @IsString() @MaxLength(160)
  attachmentName?: string;
}
