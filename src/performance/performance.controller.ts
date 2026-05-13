import { Controller, ForbiddenException, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerformanceService } from './performance.service';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    const isStaff = req.user.role === 'admin' || req.user.role === 'supervisor';
    return this.service.forWorker(req.user.id, req.user.id, isStaff);
  }

  @UseGuards(JwtAuthGuard)
  @Get('worker/:id')
  worker(@Req() req: any, @Param('id') id: string) {
    if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
      throw new ForbiddenException('Sólo administradores y supervisores');
    }
    return this.service.forWorker(id, req.user.id, true);
  }
}
