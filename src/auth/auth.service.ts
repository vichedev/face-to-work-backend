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

// Hash dummy para defender contra timing attacks (cuando el usuario no existe)
const DUMMY_HASH =
  '$2b$10$abcdefghijklmnopqrstuuQwfPiTLXocxjzKAa1MmwlxLDpFWIjUe';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    // Siempre comparar contra un hash (real o dummy) para tiempo de respuesta constante.
    const hashToCompare = user?.password || DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!user.active) {
      throw new ForbiddenException('Cuenta desactivada. Contacta al administrador.');
    }
    return this.buildTokenResponse(user);
  }

  async register(dto: RegisterDto) {
    // El alta pública crea una cuenta de administrador inicial.
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
    };
  }

  private buildTokenResponse(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    return { accessToken, user: this.publicUser(user) };
  }
}
