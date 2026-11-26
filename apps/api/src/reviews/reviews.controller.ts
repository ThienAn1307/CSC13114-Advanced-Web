import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/auth.module.js';
import { Problem } from '../common/problem.js';
import { isUuid } from '../common/request.js';
import type { SubmissionRequest } from '../common/request.js';
import type { PostgresReviewQueue } from './postgres-review-queue.js';
import type { Evidence } from '../../../../packages/db/src/review-queue.js';

export const REVIEWS = Symbol('REVIEWS');
export type ReviewReader = Pick<PostgresReviewQueue, 'list' | 'decide'>;

@Controller('v1/classes/:classId/reviews')
@UseGuards(JwtGuard)
export class ReviewsController {
  constructor(@Inject(REVIEWS) private readonly reviews: ReviewReader) {}

  @Get()
  async list(@Req() request: SubmissionRequest, @Param('classId') classId: string) {
    if (request.user!.role !== 'ta')
      throw new Problem('forbidden-role', 'Only TAs may review verdicts.');
    const result = isUuid(classId) ? await this.reviews.list(request.user!, classId) : null;
    if (!result) throw new Problem('lab-not-found', 'Lab not found.');
    return result;
  }

  @Post(':proposalId/decision')
  @HttpCode(200)
  async decide(
    @Req() request: SubmissionRequest,
    @Param('classId') classId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    if (request.user!.role !== 'ta')
      throw new Problem('forbidden-role', 'Only TAs may review verdicts.');
    const value =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (
      (value.decision !== 'pass' && value.decision !== 'violation') ||
      !Array.isArray(value.evidence)
    ) {
      throw new Problem('validation-failed', 'Invalid review decision.', [
        { pointer: '', detail: 'choose pass or violation and provide evidence' },
      ]);
    }
    const result =
      isUuid(classId) && isUuid(proposalId)
        ? await this.reviews.decide(
            request.user!,
            classId,
            proposalId,
            value.decision,
            value.evidence as Evidence[],
          )
        : 'unavailable';
    if (result === 'unavailable') throw new Problem('lab-not-found', 'Lab not found.');
    if (result === 'invalid')
      throw new Problem('validation-failed', 'Invalid review evidence.', [
        { pointer: '/evidence', detail: 'violation requires matching source lines' },
      ]);
    return result;
  }
}
