import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/auth.module.js';
import { hashPassword } from '../auth/password.js';
import { Problem } from '../common/problem.js';
import { isUuid } from '../common/request.js';
import type { SubmissionRequest } from '../common/request.js';
import { MEMBERS } from './members.js';
import type { Members } from './members.js';

@Controller('v1/classes/:classId')
@UseGuards(JwtGuard)
export class MembersController {
  constructor(@Inject(MEMBERS) private readonly members: Members) {}

  @Post('tas')
  addTa(
    @Req() request: SubmissionRequest,
    @Param('classId') classId: string,
    @Body() body: unknown,
  ): Promise<{ added: true }> {
    if (request.user!.role !== 'admin')
      throw new Problem('forbidden-role', 'Only admins may assign TAs.');
    return this.add(request, classId, body, 'ta');
  }

  @Post('students')
  addStudent(
    @Req() request: SubmissionRequest,
    @Param('classId') classId: string,
    @Body() body: unknown,
  ): Promise<{ added: true }> {
    if (request.user!.role !== 'ta')
      throw new Problem('forbidden-role', 'Only TAs may add students.');
    return this.add(request, classId, body, 'student');
  }

  private async add(
    request: SubmissionRequest,
    classId: string,
    body: unknown,
    role: 'ta' | 'student',
  ): Promise<{ added: true }> {
    const value =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
    const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : '';
    const password = value.password;
    if (
      !isUuid(classId) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !displayName ||
      displayName.length > 200 ||
      (password !== undefined &&
        (typeof password !== 'string' || password.length < 12 || password.length > 1024))
    ) {
      throw new Problem('validation-failed', 'Invalid account details.', [
        { pointer: '', detail: 'check class, email, name and password' },
      ]);
    }
    const result = await this.members.add(request.user!, classId, {
      email,
      displayName,
      role,
      ...(typeof password === 'string' ? { passwordHash: await hashPassword(password) } : {}),
    });
    if (result === 'unavailable') throw new Problem('forbidden-role', 'Class is unavailable.');
    if (result === 'invalid-account')
      throw new Problem('validation-failed', 'Account cannot be added.', [
        { pointer: '', detail: 'check account details' },
      ]);
    return { added: true };
  }
}
