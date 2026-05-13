import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DataSource, DataSourceOptions } from 'typeorm';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { UploadsModule } from './uploads/uploads.module';
import { FaceModule } from './face/face.module';
import { WorkersModule } from './workers/workers.module';
import { WorkScheduleModule } from './schedule/work-schedule.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ActivitiesModule } from './activities/activities.module';
import { PerformanceModule } from './performance/performance.module';

/**
 * Arregla diferencias de esquema que TypeORM no migra limpiamente:
 *  - `attendances.type` de varchar(8) → text (para 'lunch_out' / 'lunch_in').
 *  - Columnas `timestamp without time zone` → `timestamptz`. El driver `pg`
 *    inserta los valores como UTC pero los relee como hora LOCAL del proceso
 *    Node; al pasar el contenedor a TZ=America/Guayaquil eso provoca un
 *    desfase de 5 h (se muestra "16:25" cuando la marca real fue "11:25").
 *    Con timestamptz el round-trip es estable sin importar la TZ del proceso.
 * Corre ANTES de `synchronize`.
 */
async function preSyncFixups(ds: DataSource): Promise<void> {
  const log = new Logger('SchemaFixups');
  const qr = ds.createQueryRunner();
  try {
    // 1) attendances.type → text (1ª migración).
    if (await qr.hasTable('attendances')) {
      const col = await qr.query(
        `SELECT data_type, character_maximum_length FROM information_schema.columns
         WHERE table_name='attendances' AND column_name='type'`,
      );
      if (col?.[0] && col[0].data_type !== 'text') {
        log.log(`Migrando attendances.type (${col[0].data_type}${col[0].character_maximum_length ? `(${col[0].character_maximum_length})` : ''}) → text`);
        await ds.query(`ALTER TABLE attendances ALTER COLUMN type TYPE text`);
      }
    }

    // 2) Columnas timestamp → timestamptz (interpretando lo guardado como UTC).
    const timestampTargets: Array<[string, string]> = [
      ['users', 'createdAt'],
      ['users', 'updatedAt'],
      ['attendances', 'createdAt'],
      ['activities', 'startedAt'],
      ['activities', 'endedAt'],
      ['activities', 'updatedAt'],
      ['work_schedule', 'createdAt'],
      ['work_schedule', 'updatedAt'],
    ];
    for (const [table, column] of timestampTargets) {
      if (!(await qr.hasTable(table))) continue;
      const info = await qr.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name=$1 AND column_name=$2`,
        [table, column],
      );
      const current = info?.[0]?.data_type;
      if (current === 'timestamp without time zone') {
        log.log(`Migrando ${table}.${column} (timestamp) → timestamptz (UTC)`);
        await ds.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }
  } catch (e: any) {
    log.warn(`pre-sync fixup falló: ${e?.message || e}`);
  } finally {
    await qr.release();
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 10000, limit: 60 },
      { name: 'long', ttl: 60000, limit: 200 },
    ]),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      exclude: ['/api/(.*)', '/uploads/(.*)'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: parseInt(config.get<string>('DB_PORT') || '5432', 10),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        // No dejamos que TypeORM corra `synchronize` directamente: lo hacemos
        // manualmente tras los fixups, para que diffs problemáticos no rompan el arranque.
        synchronize: false,
      }),
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) throw new Error('TypeORM options no definidos');
        const config = new ConfigService(); // ConfigModule global, ya cargado
        const wantSync = config.get<string>('DB_SYNC') !== 'false';
        const ds = await new DataSource(options).initialize();
        if (wantSync) {
          await preSyncFixups(ds);
          await ds.synchronize();
        }
        return ds;
      },
    }),
    AuthModule,
    UsersModule,
    UploadsModule,
    FaceModule,
    WorkersModule,
    WorkScheduleModule,
    AttendanceModule,
    ActivitiesModule,
    PerformanceModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
