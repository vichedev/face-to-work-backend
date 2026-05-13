import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly service: PushService) {}

  /** El frontend pide la VAPID public key para registrar el Service Worker. */
  @Get('public-key')
  publicKey() {
    return { enabled: this.service.enabled, publicKey: this.service.publicKey() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  subscribe(
    @Req() req: any,
    @Body() body: { subscription: any; userAgent?: string },
  ) {
    return this.service.subscribe(req.user.id, body.subscription, body.userAgent || req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('subscribe')
  unsubscribe(@Req() req: any, @Body() body: { endpoint: string }) {
    return this.service.unsubscribe(req.user.id, body.endpoint);
  }

  /** Envía una notificación de prueba al propio usuario. */
  @UseGuards(JwtAuthGuard)
  @Post('test')
  test(@Req() req: any) {
    return this.service.notifyUser(req.user.id, {
      title: 'Notificación de prueba',
      body: 'Si ves esto, las notificaciones push funcionan correctamente.',
      url: '/',
      tag: 'test',
    });
  }
}
