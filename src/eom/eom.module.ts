import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeOfMonthAward } from './eom-award.entity';
import { EomReward } from './eom-reward.entity';
import { User } from '../users/user.entity';
import { EomService } from './eom.service';
import { EomRewardsService } from './eom-rewards.service';
import { EomController } from './eom.controller';
import { PayrollModule } from '../payroll/payroll.module';
import { PushModule } from '../push/push.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmployeeOfMonthAward, EomReward, User]),
    PayrollModule,
    PushModule,
    AuditModule,
  ],
  providers: [EomService, EomRewardsService],
  controllers: [EomController],
})
export class EomModule {}
