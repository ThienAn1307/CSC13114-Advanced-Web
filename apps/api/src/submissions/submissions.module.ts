import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
