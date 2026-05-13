import { Body, Controller, Get, Patch, Post, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { TwoFactorService } from './two-factor.service';
import { Disable2FADto, TotpLoginDto, VerifyTotpDto } from './dto/two-factor.dto';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  // Limita intentos de login: 5 por minuto por IP
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('2fa/login')
  twoFactorLogin(@Body() dto: TotpLoginDto) {
    return this.authService.loginWith2FA(dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }

  // ── Perfil propio (admin o worker) ──
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.id, dto);
  }

  /** Invalida todas las otras sesiones del usuario (incrementa tokenVersion). */
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  logoutAll(@Req() req: any) {
    return this.authService.logoutAllOtherSessions(req.user.id);
  }

  // ── 2FA: activación / verificación / desactivación (sólo admin) ──
  @UseGuards(AdminGuard)
  @Post('2fa/setup')
  setup2FA(@Req() req: any) {
    return this.twoFactor.beginSetup(req.user.id);
  }

  @UseGuards(AdminGuard)
  @Post('2fa/verify-setup')
  verify2FASetup(@Req() req: any, @Body() dto: VerifyTotpDto) {
    return this.twoFactor.verifySetup(req.user.id, dto.code);
  }

  @UseGuards(AdminGuard)
  @Post('2fa/disable')
  disable2FA(@Req() req: any, @Body() dto: Disable2FADto) {
    return this.twoFactor.disable(req.user.id, dto.code, dto.password);
  }
}
