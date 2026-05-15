import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import { User } from '../users/user.entity';

const TOTP_DIGITS = 6 as const;
const TOTP_PERIOD = 30; // segundos
const TOTP_TOLERANCE = 30; // ±30 s → tolera 1 step de desfase de reloj

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  private issuer(): string {
    return this.config.get<string>('COMPANY_NAME') || 'Face to Work';
  }

  /** Trae el usuario incluyendo `totpSecret` y `password` (ambos son `select: false`). */
  private loadFull(id: string) {
    return this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .addSelect('u.totpSecret')
      .where('u.id = :id', { id })
      .getOne();
  }

  private check(token: string, secret: string): boolean {
    if (!token || !secret) return false;
    try {
      const res = verifySync({
        token: String(token).trim(),
        secret,
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD,
        epochTolerance: TOTP_TOLERANCE,
      });
      return !!res.valid;
    } catch {
      return false;
    }
  }

  /**
   * Genera un secreto nuevo (NO lo activa todavía: hace falta verificar con un código).
   * Devuelve el otpauth URL + QR en data URL para escanear con Authenticator.
   */
  async beginSetup(userId: string) {
    const user = await this.loadFull(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.role !== 'admin') throw new ForbiddenException('Sólo los administradores pueden activar 2FA');
    if (user.totpEnabled) throw new ConflictException('2FA ya está activado para esta cuenta');

    const secret = generateSecret();
    const otpauth = generateURI({
      issuer: this.issuer(),
      label: user.email,
      secret,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
    });
    const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 256 });

    await this.usersRepo.update(userId, { totpSecret: secret });
    return { secret, otpauth, qrDataUrl };
  }

  async verifySetup(userId: string, code: string) {
    const user = await this.loadFull(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.totpEnabled) throw new ConflictException('2FA ya está activado');
    if (!user.totpSecret) throw new BadRequestException('Primero genera el código QR ("setup")');
    if (!this.check(code, user.totpSecret)) {
      throw new UnauthorizedException('Código incorrecto');
    }
    await this.usersRepo.update(userId, { totpEnabled: true });
    return { ok: true };
  }

  async disable(userId: string, code: string, password: string) {
    const user = await this.loadFull(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.totpEnabled) throw new BadRequestException('2FA no está activado');
    if (!password || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Contraseña incorrecta');
    }
    if (!this.check(code, user.totpSecret)) {
      throw new UnauthorizedException('Código TOTP incorrecto');
    }
    // Desactivar 2FA es un evento de seguridad. Invalidamos cualquier otra sesión
    // del usuario por seguridad — si un atacante con un token robado intentó
    // bajar el 2FA, su sesión queda quemada. El controller emite un token fresco
    // para la sesión que ejecutó esta acción.
    await this.usersRepo.update(userId, {
      totpEnabled: false,
      totpSecret: '',
      tokenVersion: (user.tokenVersion || 0) + 1,
    });
    return { ok: true };
  }

  /** Verifica un código TOTP contra el secreto guardado del usuario. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.loadFull(userId);
    if (!user || !user.totpEnabled || !user.totpSecret) return false;
    return this.check(code, user.totpSecret);
  }
}
