import { Module } from '@nestjs/common';
import { FaceService } from './face.service';
import { FaceController } from './face.controller';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  controllers: [FaceController],
  providers: [FaceService],
  exports: [FaceService],
})
export class FaceModule {}
