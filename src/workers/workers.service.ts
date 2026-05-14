import { BadRequestException, Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { FaceService } from '../face/face.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';

type PublicWorker = Omit<User, 'password'>;

/** Gestión de trabajadores (usuarios con rol `worker`). */
@Injectable()
export class WorkersService {
  constructor(
    private readonly users: UsersService,
    private readonly faceService: FaceService,
    private readonly uploads: UploadsService,
  ) {}

  private strip(u: User): PublicWorker {
    const { password, ...rest } = u;
    void password;
    return rest;
  }

  async findAll(includeInactive = true): Promise<PublicWorker[]> {
    const list = await this.users.findWorkers(includeInactive);
    return list.map((u) => this.strip(u));
  }

  async findOne(id: string): Promise<PublicWorker> {
    return this.strip(await this.users.findWorkerOrThrow(id));
  }

  private async processPhoto(dataUrl: string): Promise<{ photoUrl: string; faceDescriptor: Record<string, any> | null }> {
    let photoUrl: string;
    try {
      photoUrl = this.uploads.saveDataUrl(dataUrl, 'worker');
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Foto inválida');
    }
    const faceDescriptor = await this.faceService.describeFace(dataUrl);
    return { photoUrl, faceDescriptor };
  }

  async create(dto: CreateWorkerDto): Promise<PublicWorker> {
    let photoUrl = '';
    let faceDescriptor: Record<string, any> | null = null;
    if (dto.photoBase64) {
      const r = await this.processPhoto(dto.photoBase64);
      photoUrl = r.photoUrl;
      faceDescriptor = r.faceDescriptor;
    }
    const created = await this.users.create({
      email: dto.email,
      password: dto.password,
      name: dto.fullName,
      role: 'worker',
      code: dto.code,
      position: dto.position || '',
      department: dto.department || '',
      phone: dto.phone || '',
      photoUrl,
      faceDescriptor,
      active: dto.active ?? true,
      // Forzar al trabajador a cambiar la contraseña en su primer login.
      mustChangePassword: true,
    });
    return this.strip(created);
  }

  /** Resetea la contraseña a una temporal y la devuelve al admin (solo en respuesta). */
  async resetPassword(id: string): Promise<{ tempPassword: string }> {
    await this.users.findWorkerOrThrow(id);
    const tempPassword = generateTempPassword();
    await this.users.resetPassword(id, tempPassword);
    return { tempPassword };
  }

  async update(id: string, dto: UpdateWorkerDto): Promise<PublicWorker> {
    await this.users.findWorkerOrThrow(id);
    const patch: any = {};
    if (dto.fullName !== undefined) patch.name = dto.fullName;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.password) patch.password = dto.password;
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.department !== undefined) patch.department = dto.department;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.active !== undefined) patch.active = dto.active;
    if (dto.internalNotes !== undefined) patch.internalNotes = dto.internalNotes;
    if (dto.photoBase64) {
      const r = await this.processPhoto(dto.photoBase64);
      patch.photoUrl = r.photoUrl;
      patch.faceDescriptor = r.faceDescriptor;
    }
    return this.strip(await this.users.update(id, patch));
  }

  async remove(id: string) {
    await this.users.findWorkerOrThrow(id);
    return this.users.remove(id);
  }
}

/** Genera una contraseña temporal legible (12 caracteres, alfanumérica sin caracteres confusos). */
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
