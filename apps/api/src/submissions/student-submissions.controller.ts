import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { JwtGuard, StudentGuard } from '../auth/auth.module.js';
import type { SubmissionRequest } from '../common/request.js';
import { isUuid } from '../common/request.js';
import { Problem } from '../common/problem.js';
import { STUDENT_SUBMISSIONS } from './student-submissions.js';
import type { StudentSubmissions, StudentSubmissionStatus } from './student-submissions.js';

@Controller('v1/submissions')
@UseGuards(JwtGuard, StudentGuard)
export class StudentSubmissionsController {
  constructor(@Inject(STUDENT_SUBMISSIONS) private readonly submissions: StudentSubmissions) {}

  @Get()
  list(@Req() request: SubmissionRequest): Promise<StudentSubmissionStatus[]> {
    return this.submissions.list(request.user!.id);
  }

  @Get(':submissionId/tests')
  async tests(@Req() request: SubmissionRequest, @Param('submissionId') submissionId: string) {
    const result = isUuid(submissionId)
      ? await this.submissions.listTests(request.user!.id, submissionId)
      : null;
    if (!result) throw new Problem('lab-not-found', 'Lab not found.');
    return result;
  }
}
