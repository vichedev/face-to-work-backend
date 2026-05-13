import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReminderSent } from './reminder-sent.entity';
import { Attendance } from '../attendance/attendance.entity';
import { Activity } from '../activities/activity.entity';
import { User } from '../users/user.entity';
import { WorkScheduleModule } from '../schedule/work-schedule.module';
import { PushModule } from '../push/push.module';
import { RemindersService } from './reminders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReminderSent, Attendance, Activity, User]),
    WorkScheduleModule,
    PushModule,
  ],
  providers: [RemindersService],
})
export class RemindersModule {}
