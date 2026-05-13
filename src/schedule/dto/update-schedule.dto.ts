import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateScheduleDto {
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  /** { "0": { enabled, start: "HH:mm", end: "HH:mm" }, ... "6": {...} } — el servicio lo sanea. */
  @IsOptional() @IsObject()
  days?: Record<string, { enabled?: boolean; start?: string; end?: string }>;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  lateAfterMinutes?: number;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  absentAfterMinutes?: number;

  @IsOptional() @IsBoolean()
  overtimeEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  overtimeAfterMinutes?: number;

  @IsOptional() @IsBoolean()
  earlyLeaveEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  earlyLeaveBeforeMinutes?: number;

  /** [{ date: "YYYY-MM-DD", name: "..." }, ...] — el servicio lo sanea. */
  @IsOptional() @IsArray()
  holidays?: Array<{ date?: string; name?: string }>;

  // --- Oficina / centro de trabajo ---
  @IsOptional() @IsString() @MaxLength(120)
  officeName?: string;

  @IsOptional()
  officeLatitude?: number | null;

  @IsOptional()
  officeLongitude?: number | null;

  @IsOptional() @IsInt() @Min(10) @Max(10000)
  officeRadiusMeters?: number;

  @IsOptional() @IsBoolean()
  geofenceEnabled?: boolean;
}
