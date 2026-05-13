import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Igual que JwtAuthGuard pero además exige rol `admin` o `supervisor`.
 * Útil para endpoints de SOLO LECTURA del panel administrativo.
 * Las acciones destructivas o de configuración siguen usando `AdminGuard`.
 */
@Injectable()
export class StaffGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    const req = context.switchToHttp().getRequest();
    if (req.user?.role !== 'admin' && req.user?.role !== 'supervisor') {
      throw new ForbiddenException('Solo administradores y supervisores');
    }
    return true;
  }
}
