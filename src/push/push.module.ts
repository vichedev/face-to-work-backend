import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from './push-subscription.entity';
import { PushService } from './push.service';
import { PushController } from './push.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription])],
  providers: [PushService],
  controllers: [PushController],
  exports: [PushService],
})
export class PushModule {}
