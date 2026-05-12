import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const app = await NestFactory.create(AppModule, {
    // Desactivamos el body parser por defecto (límite 100kb) y configuramos uno más amplio:
    // las fotos viajan como base64 dentro del JSON.
    bodyParser: false,
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const config = app.get(ConfigService);

  // Body parser con límite amplio (suficiente para fotos en base64; UploadsService corta a 8 MB)
  app.use(json({ limit: '16mb' }));
  app.use(urlencoded({ extended: true, limit: '16mb' }));

  // Seguridad: cabeceras HTTP
  app.use(
    helmet({
      contentSecurityPolicy: false, // Deshabilitado: el front ya inyecta su propio CSP
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // permite imágenes de uploads
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Seguridad: ocultar header con versión de Express
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // Performance: compresión gzip
  app.use(compression());

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'uploads/(.*)', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Confianza limitada en proxy (solo si hay reverse proxy delante)
  if (config.get<string>('TRUST_PROXY') === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  const frontendUrl =
    config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
  const allowedOrigins = frontendUrl
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['Content-Length', 'Content-Range'],
    maxAge: 86400,
  });

  // Manejo grácil de cierre
  app.enableShutdownHooks();

  const port = config.get<number>('PORT') || 3000;
  await app.listen(port);
  logger.log(`Backend escuchando en http://localhost:${port}/api`);
  logger.log(`CORS permitido para: ${allowedOrigins.join(', ')}`);
}
bootstrap();
