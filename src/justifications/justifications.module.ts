import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Justification } from './justification.entity';
import { User } from '../users/user.entity';
import { JustificationsService } from './justifications.service';
import { JustificationsController } from './justifications.controller';
import { UploadsModule } from '../uploads/uploads.module';
import { AuditModule } from '../audit/audit.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Justification, User]),
    UploadsModule,
    AuditModule,
    PushModule,
  ],
  providers: [JustificationsService],
  controllers: [JustificationsController],
  exports: [JustificationsService],
})
export class JustificationsModule {}
