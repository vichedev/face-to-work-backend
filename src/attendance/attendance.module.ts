import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from './attendance.entity';
import { Activity } from '../activities/activity.entity';
import { User } from '../users/user.entity';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { FaceModule } from '../face/face.module';
import { UploadsModule } from '../uploads/uploads.module';
import { WorkScheduleModule } from '../schedule/work-schedule.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attendance, Activity, User]),
    FaceModule,
    UploadsModule,
    WorkScheduleModule,
    AuditModule,
  ],
  providers: [AttendanceService],
  controllers: [AttendanceController],
})
export class AttendanceModule {}
