import { Controller, ForbiddenException, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerformanceService } from './performance.service';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.service.forWorker(req.user.id, req.user.id, req.user.role === 'admin');
  }

  @UseGuards(JwtAuthGuard)
  @Get('worker/:id')
  worker(@Req() req: any, @Param('id') id: string) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Sólo administradores');
    return this.service.forWorker(id, req.user.id, true);
  }
}
