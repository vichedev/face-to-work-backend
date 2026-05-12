import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        const logger = new Logger('AuthModule');

        if (!secret || secret.length < 32) {
          if (config.get<string>('NODE_ENV') === 'production') {
            throw new Error(
              'JWT_SECRET debe estar definido y tener al menos 32 caracteres en producción',
            );
          }
          logger.warn(
            'JWT_SECRET no definido o demasiado corto. Usa al menos 32 caracteres en producción.',
          );
        }

        return {
          secret: secret || 'development-only-fallback-do-not-use-in-prod',
          signOptions: {
            expiresIn: config.get<string>('JWT_EXPIRES_IN') || '7d',
            issuer: 'face-to-work',
          },
        };
      },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
