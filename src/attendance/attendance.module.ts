import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from './attendance.entity';
import { User } from '../users/user.entity';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { FaceModule } from '../face/face.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attendance, User]),
    FaceModule,
    UploadsModule,
  ],
  providers: [AttendanceService],
  controllers: [AttendanceController],
})
export class AttendanceModule {}
