import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from '../attendance/attendance.entity';
import { Activity } from '../activities/activity.entity';
import { Justification } from '../justifications/justification.entity';
import { User } from '../users/user.entity';
import { WorkScheduleModule } from '../schedule/work-schedule.module';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attendance, Activity, Justification, User]),
    WorkScheduleModule,
  ],
  providers: [PayrollService],
  controllers: [PayrollController],
})
export class PayrollModule {}
