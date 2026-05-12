import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const usersService = app.get(UsersService);

  const email = config.get<string>('ADMIN_EMAIL');
  const password = config.get<string>('ADMIN_PASSWORD');
  const name = config.get<string>('ADMIN_NAME') || 'Administrador';

  if (!email || !password) {
    console.error('ADMIN_EMAIL y ADMIN_PASSWORD son requeridos en .env');
    await app.close();
    process.exit(1);
  }

  const existing = await usersService.findByEmail(email);
  if (existing) {
    console.log(`✓ Usuario administrador ${email} ya existe.`);
  } else {
    await usersService.create({ email, password, name, role: 'admin' });
    console.log(`✓ Usuario administrador creado: ${email} / ${password}`);
  }

  await app.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Error en seed:', err);
  process.exit(1);
});
