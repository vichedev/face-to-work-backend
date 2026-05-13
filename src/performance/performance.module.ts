import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from '../attendance/attendance.entity';
import { Activity } from '../activities/activity.entity';
import { User } from '../users/user.entity';
import { WorkScheduleModule } from '../schedule/work-schedule.module';
import { PerformanceService } from './performance.service';
import { PerformanceController } from './performance.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Attendance, Activity, User]), WorkScheduleModule],
  providers: [PerformanceService],
  controllers: [PerformanceController],
  exports: [PerformanceService],
})
export class PerformanceModule {}
