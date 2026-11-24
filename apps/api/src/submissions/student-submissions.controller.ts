import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { JwtGuard, StudentGuard } from '../auth/auth.module.js';
import type { SubmissionRequest } from '../common/request.js';
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
}
