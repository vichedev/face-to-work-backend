import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

class CreateAdminDto {
  @Transform(trim) @IsEmail()
  email: string;

  @IsString() @MinLength(8)
  password: string;

  @Transform(trim) @IsString() @MinLength(2)
  name: string;

  @IsIn(['admin', 'supervisor'])
  role: 'admin' | 'supervisor';

  @IsOptional() @Transform(trim) @IsString()
  phone?: string;
}

class UpdateAdminDto {
  @IsOptional() @IsIn(['admin', 'supervisor'])
  role?: 'admin' | 'supervisor';

  @IsOptional()
  active?: boolean;
}

/**
 * Endpoints de gestión de cuentas administrativas (admin + supervisor).
 * Estrictamente bajo `AdminGuard` — un supervisor NO puede gestionar otros admins.
 */
@UseGuards(AdminGuard)
@Controller('admins')
export class AdminsController {
  constructor(
    private readonly users: UsersService,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  @Get()
  async list() {
    const list = await this.usersRepo.find({
      where: { role: In(['admin', 'supervisor']) },
      order: { createdAt: 'ASC' },
    });
    return list.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      phone: u.phone,
      photoUrl: u.photoUrl,
      active: u.active,
      totpEnabled: u.totpEnabled,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
    }));
  }

  @Post()
  async create(@Body() dto: CreateAdminDto) {
    const u = await this.users.create({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      role: dto.role,
      phone: dto.phone,
      active: true,
      mustChangePassword: true,
    });
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAdminDto) {
    if (id === req.user.id && dto.role && dto.role !== 'admin') {
      throw new BadRequestException('No puedes degradarte a ti mismo. Pide a otro admin que lo haga.');
    }
    if (id === req.user.id && dto.active === false) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta.');
    }
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Cuenta no encontrada');
    if (target.role === 'worker') throw new BadRequestException('Esta cuenta no es administrativa');

    // Si voy a desactivar / degradar al ÚLTIMO admin activo, bloquear.
    if ((dto.role && dto.role !== 'admin' && target.role === 'admin') || (dto.active === false && target.role === 'admin')) {
      const remaining = await this.usersRepo.count({ where: { role: 'admin', active: true, id: Not(id) } });
      if (remaining === 0) throw new BadRequestException('No puedes desactivar/degradar al único admin activo del sistema.');
    }

    return this.users.update(id, dto as any);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    if (id === req.user.id) throw new BadRequestException('No puedes eliminar tu propia cuenta.');
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Cuenta no encontrada');
    if (target.role === 'worker') throw new ForbiddenException('Usa /workers para eliminar trabajadores');
    if (target.role === 'admin') {
      const remaining = await this.usersRepo.count({ where: { role: 'admin', active: true, id: Not(id) } });
      if (remaining === 0) throw new BadRequestException('No puedes eliminar al único admin activo del sistema.');
    }
    return this.users.remove(id);
  }

  /** Resetea la contraseña de otro admin/supervisor a una temporal. */
  @Post(':id/reset-password')
  async reset(@Req() req: any, @Param('id') id: string) {
    if (id === req.user.id) throw new BadRequestException('Para cambiar tu propia contraseña usa /auth/change-password.');
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target || target.role === 'worker') throw new BadRequestException('Cuenta no encontrada');
    const tempPassword = randomTempPassword();
    await this.users.resetPassword(id, tempPassword);
    return { tempPassword };
  }
}

function randomTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
