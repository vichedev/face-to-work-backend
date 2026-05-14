import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FaceService } from './face.service';
import { UploadsService } from '../uploads/uploads.service';

class AnalyzeMoodDto {
  /** Ruta interna de una foto ya guardada (campo `photoUrl` de un marcaje). */
  @IsOptional() @IsString() @MaxLength(500)
  photoUrl?: string;

  /** Foto en data URL base64 (caso: foto recién capturada que aún no se guardó). */
  @IsOptional() @IsString()
  photoBase64?: string;

  /** Nombre del trabajador (para personalizar el mensaje). */
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;
}

@Controller('face')
export class FaceController {
  constructor(
    private readonly face: FaceService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Analiza el estado de ánimo aparente en una foto y devuelve un mensaje cálido.
   * El uso es informativo — nunca penaliza ni decide nada automáticamente.
   * Throttle pequeño para evitar abuso de la API de Groq (cada llamada cuesta).
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Post('mood')
  async mood(@Body() dto: AnalyzeMoodDto) {
    let imageUrl: string | null = null;
    if (dto.photoBase64) {
      imageUrl = dto.photoBase64;
    } else if (dto.photoUrl) {
      // photoUrl es una ruta interna tipo /uploads/xxx.jpg → la leemos como data URL.
      imageUrl = this.uploads.readAsDataUrl(dto.photoUrl);
    }
    if (!imageUrl) throw new BadRequestException('Se requiere photoUrl o photoBase64');
    return this.face.analyzeMood(imageUrl, { name: dto.name });
  }
}
