import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Justification } from './justification.entity';
import { User } from '../users/user.entity';
import { JustificationsService } from './justifications.service';
import { JustificationsController } from './justifications.controller';
import { UploadsModule } from '../uploads/uploads.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Justification, User]),
    UploadsModule,
    AuditModule,
  ],
  providers: [JustificationsService],
  controllers: [JustificationsController],
})
export class JustificationsModule {}
