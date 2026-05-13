import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { BrandingService, UpdateBrandingDto } from './branding.service';

@Controller('branding')
export class BrandingController {
  constructor(private readonly service: BrandingService) {}

  /** Público: el login y la SPA leen marca antes de autenticarse. */
  @Get()
  get() {
    return this.service.get();
  }

  @UseGuards(AdminGuard)
  @Patch()
  update(@Body() dto: UpdateBrandingDto) {
    return this.service.update(dto);
  }
}
