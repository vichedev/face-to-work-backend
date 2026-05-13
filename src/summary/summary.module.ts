import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from '../attendance/attendance.entity';
import { JustificationsModule } from '../justifications/justifications.module';
import { TasksModule } from '../tasks/tasks.module';
import { SummaryController } from './summary.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Attendance]), JustificationsModule, TasksModule],
  controllers: [SummaryController],
})
export class SummaryModule {}
