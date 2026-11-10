import { Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard, StudentGuard } from '../auth/auth.module.js';
import type { SubmissionRequest } from '../common/request.js';
import { SubmissionsService } from './submissions.service.js';
import type { SubmissionReceiptDto } from './submission.dto.js';

@Controller('v1/labs')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Post(':labId/submissions')
  @HttpCode(202)
  @UseGuards(JwtGuard, StudentGuard)
  async create(
    @Req() request: SubmissionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubmissionReceiptDto> {
    const result = await this.submissions.submit(
      request.user!.id,
      String(request.params.labId),
      request.headers['idempotency-key'],
      request.body as unknown,
      request.receivedAt,
    );
    response.setHeader('Location', `/v1/submissions/${result.receipt.id}`);
    if (result.replayed) response.setHeader('Idempotent-Replayed', 'true');
    return result.receipt;
  }
}
