import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { ActivitiesService } from './activities.service';
import { StartActivityDto } from './dto/start-activity.dto';
import { EndActivityDto } from './dto/end-activity.dto';
import { AdminUpdateActivityDto } from './dto/admin-update-activity.dto';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly service: ActivitiesService) {}

  // -- Trabajador --
  @UseGuards(JwtAuthGuard)
  @Post('start')
  start(@Req() req: any, @Body() dto: StartActivityDto) {
    return this.service.start(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/end')
  end(@Req() req: any, @Param('id') id: string, @Body() dto: EndActivityDto) {
    return this.service.end(req.user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/current')
  current(@Req() req: any) {
    return this.service.findCurrent(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  mine(
    @Req() req: any,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findMine(req.user.id, { month, from, to });
  }

  // -- Vista individual: trabajador su propia, admin cualquiera --
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const a = await this.service.findOne(id);
    if (req.user.role !== 'admin' && a.workerId !== req.user.id) {
      throw new ForbiddenException('No tienes acceso a esta actividad');
    }
    return a;
  }

  // -- Administración --
  @UseGuards(AdminGuard)
  @Get()
  list(
    @Query('workerId') workerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({ workerId, from, to, status, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateActivityDto) {
    return this.service.adminUpdate(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.adminRemove(id);
  }
}
