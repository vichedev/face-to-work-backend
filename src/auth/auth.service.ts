import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TwoFactorService } from './two-factor.service';
import { TotpLoginDto } from './dto/two-factor.dto';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';
import { UploadsService } from '../uploads/uploads.service';
import { FaceService } from '../face/face.service';

// Hash dummy para defender contra timing attacks (cuando el usuario no existe)
const DUMMY_HASH =
  '$2b$10$abcdefghijklmnopqrstuuQwfPiTLXocxjzKAa1MmwlxLDpFWIjUe';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly twoFactor: TwoFactorService,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly uploads: UploadsService,
    private readonly faceService: FaceService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    const hashToCompare = user?.password || DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!user.active) {
      throw new ForbiddenException('Cuenta desactivada. Contacta al administrador.');
    }

    // Cuenta con 2FA → devolvemos un token TEMPORAL en lugar del access token.
    // El frontend pide el código de 6 dígitos y llama a /auth/2fa/login.
    if (user.totpEnabled) {
      const tempToken = this.jwtService.sign(
        { sub: user.id, type: 'pre-2fa' },
        { expiresIn: '5m' },
      );
      return { requires2FA: true, tempToken };
    }
    return this.buildTokenResponse(user);
  }

  async loginWith2FA(dto: TotpLoginDto) {
    let payload: any;
    try {
      payload = this.jwtService.verify(dto.tempToken);
    } catch {
      throw new UnauthorizedException('Sesión 2FA expirada. Vuelve a iniciar sesión.');
    }
    if (payload?.type !== 'pre-2fa' || !payload?.sub) {
      throw new UnauthorizedException('Token 2FA inválido');
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedException('Usuario no disponible');
    const ok = await this.twoFactor.verifyCode(user.id, dto.code);
    if (!ok) throw new UnauthorizedException('Código incorrecto');
    return this.buildTokenResponse(user);
  }

  async register(dto: RegisterDto) {
    const user = await this.usersService.create({ ...dto, role: 'admin' });
    return this.buildTokenResponse(user);
  }

  publicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      code: user.code,
      position: user.position,
      department: user.department,
      phone: user.phone,
      photoUrl: user.photoUrl,
      hasFace: !!user.faceDescriptor,
      active: user.active,
      totpEnabled: !!user.totpEnabled,
      mustChangePassword: !!user.mustChangePassword,
    };
  }

  private buildTokenResponse(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion || 0,
    };
    const accessToken = this.jwtService.sign(payload);
    return { accessToken, user: this.publicUser(user) };
  }

  /** Permite a CUALQUIER usuario autenticado actualizar su propio perfil. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const patch: Partial<User> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.phone !== undefined) patch.phone = (dto.phone || '').trim();
    if (dto.photoBase64) {
      try {
        patch.photoUrl = this.uploads.saveDataUrl(dto.photoBase64, 'profile');
      } catch (e: any) {
        throw new BadRequestException(e?.message || 'Foto inválida');
      }
      // Si es trabajador, recalcular el descriptor facial con la nueva foto
      // (para que el reconocimiento siga funcionando con la imagen actualizada).
      if (user.role === 'worker') {
        const desc = await this.faceService.describeFace(dto.photoBase64).catch(() => null);
        if (desc) patch.faceDescriptor = desc;
      }
    }
    // update() no toca columnas no presentes — preserva password y totpSecret.
    if (Object.keys(patch).length > 0) {
      await this.usersRepo.update(userId, patch);
    }
    const fresh = await this.usersService.findById(userId);
    return this.publicUser(fresh!);
  }

  /** Cambio de contraseña con verificación de la actual. */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new UnauthorizedException('La contraseña actual es incorrecta');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser distinta de la actual');
    }
    const newHash = await bcrypt.hash(dto.newPassword, 10);
    // Bump de tokenVersion invalida cualquier otra sesión activa de este usuario.
    await this.usersRepo.update(userId, {
      password: newHash,
      mustChangePassword: false,
      tokenVersion: (user.tokenVersion || 0) + 1,
    });
    // Devolver un nuevo accessToken con la nueva tokenVersion para que la sesión actual no se invalide.
    const fresh = await this.usersService.findById(userId);
    return this.buildTokenResponse(fresh!);
  }

  /** Cierra todas las otras sesiones del usuario (bump de tokenVersion). */
  async logoutAllOtherSessions(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.usersRepo.update(userId, { tokenVersion: (user.tokenVersion || 0) + 1 });
    const fresh = await this.usersService.findById(userId);
    return this.buildTokenResponse(fresh!);
  }
}
