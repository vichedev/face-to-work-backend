import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './user.entity';

interface CreateUserData {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  code?: string | null;
  position?: string;
  department?: string;
  phone?: string;
  photoUrl?: string;
  faceDescriptor?: Record<string, any> | null;
  active?: boolean;
  /** Si true, forzará al usuario a cambiar la contraseña en su primer login. */
  mustChangePassword?: boolean;
}

interface UpdateUserData {
  email?: string;
  password?: string; // se vuelve a hashear si viene
  name?: string;
  code?: string | null;
  position?: string;
  department?: string;
  phone?: string;
  photoUrl?: string;
  faceDescriptor?: Record<string, any> | null;
  active?: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  /** Incluye el hash de la contraseña (`password` es `select: false`); necesario para el login. */
  findByEmail(email: string) {
    return this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.email = :email', { email: email.toLowerCase().trim() })
      .getOne();
  }

  findById(id: string) {
    return this.usersRepo.findOne({ where: { id } });
  }

  // --- Trabajadores ---

  findWorkers(includeInactive = true): Promise<User[]> {
    return this.usersRepo.find({
      where: includeInactive ? { role: 'worker' } : { role: 'worker', active: true },
      order: { name: 'ASC' },
    });
  }

  async findWorkerOrThrow(id: string): Promise<User> {
    const w = await this.usersRepo.findOne({ where: { id } });
    if (!w || w.role !== 'worker') throw new NotFoundException('Trabajador no encontrado');
    return w;
  }

  // --- Creación / actualización ---

  async create(data: CreateUserData): Promise<User> {
    const email = data.email.toLowerCase().trim();
    const existing = await this.findByEmail(email);
    if (existing) throw new ConflictException('Ya existe un usuario con ese correo');
    if (data.code) {
      const byCode = await this.usersRepo.findOne({ where: { code: data.code } });
      if (byCode) throw new ConflictException('Ya existe un trabajador con ese código');
    }
    const user = this.usersRepo.create({
      email,
      password: await bcrypt.hash(data.password, 10),
      name: data.name.trim(),
      role: data.role || 'admin',
      code: data.code || null,
      position: data.position || '',
      department: data.department || '',
      phone: data.phone || '',
      photoUrl: data.photoUrl || '',
      faceDescriptor: data.faceDescriptor ?? null,
      active: data.active ?? true,
      mustChangePassword: data.mustChangePassword ?? false,
    });
    return this.usersRepo.save(user);
  }

  /** Resetea la contraseña a una temporal y marca `mustChangePassword=true`. Usado por el admin. */
  async resetPassword(id: string, tempPassword: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const hash = await bcrypt.hash(tempPassword, 10);
    // tokenVersion + 1 invalida cualquier sesión activa que tuviera ese usuario.
    await this.usersRepo.update(id, {
      password: hash,
      mustChangePassword: true,
      tokenVersion: (user.tokenVersion || 0) + 1,
    });
    return { ok: true };
  }

  /** Incrementa tokenVersion → invalida TODOS los JWTs emitidos para ese usuario. */
  async bumpTokenVersion(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.usersRepo.update(id, { tokenVersion: (user.tokenVersion || 0) + 1 });
    return { ok: true };
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    // Cargamos los campos `select: false` (password y totpSecret) para que un save()
    // sin modificarlos NO los pise con su valor por defecto. Si no lo hacemos, un
    // admin con 2FA activado perdería el secreto al editarse cualquier campo.
    const user = await this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .addSelect('u.totpSecret')
      .where('u.id = :id', { id })
      .getOne();
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (data.email && data.email.toLowerCase().trim() !== user.email) {
      const email = data.email.toLowerCase().trim();
      const dup = await this.usersRepo.findOne({ where: { email, id: Not(id) } });
      if (dup) throw new ConflictException('Ya existe un usuario con ese correo');
      user.email = email;
    }
    if (data.code !== undefined && data.code !== user.code) {
      if (data.code) {
        const dup = await this.usersRepo.findOne({ where: { code: data.code, id: Not(id) } });
        if (dup) throw new ConflictException('Ya existe un trabajador con ese código');
      }
      user.code = data.code || null;
    }
    if (data.password) user.password = await bcrypt.hash(data.password, 10);
    if (data.name !== undefined) user.name = data.name.trim();
    if (data.position !== undefined) user.position = data.position;
    if (data.department !== undefined) user.department = data.department;
    if (data.phone !== undefined) user.phone = data.phone;
    if (data.photoUrl !== undefined) user.photoUrl = data.photoUrl;
    if (data.faceDescriptor !== undefined) user.faceDescriptor = data.faceDescriptor;
    if (data.active !== undefined) user.active = data.active;
    return this.usersRepo.save(user);
  }

  /** Guarda cambios sueltos de un usuario ya cargado (uso interno). */
  patch(user: User): Promise<User> {
    return this.usersRepo.save(user);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.usersRepo.remove(user);
    return { ok: true };
  }

  async validatePassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }
}
