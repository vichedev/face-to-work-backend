import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TwoFactorService } from './two-factor.service';
import { TotpLoginDto } from './dto/two-factor.dto';

// Hash dummy para defender contra timing attacks (cuando el usuario no existe)
const DUMMY_HASH =
  '$2b$10$abcdefghijklmnopqrstuuQwfPiTLXocxjzKAa1MmwlxLDpFWIjUe';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly twoFactor: TwoFactorService,
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
    };
  }

  private buildTokenResponse(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    return { accessToken, user: this.publicUser(user) };
  }
}
