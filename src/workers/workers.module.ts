import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Attendance } from '../attendance/attendance.entity';
import { Activity } from '../activities/activity.entity';
import { Justification } from '../justifications/justification.entity';
import { UsersModule } from '../users/users.module';
import { WorkersService } from './workers.service';
import { WorkersController } from './workers.controller';
import { WorkersExportService } from './workers-export.service';
import { FaceModule } from '../face/face.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Attendance, Activity, Justification]),
    UsersModule,
    FaceModule,
    UploadsModule,
    AuditModule,
  ],
  providers: [WorkersService, WorkersExportService],
  controllers: [WorkersController],
  exports: [WorkersService],
})
export class WorkersModule {}
