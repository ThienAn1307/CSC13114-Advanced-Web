import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/auth.module.js';
import { Problem } from '../common/problem.js';
import type { SubmissionRequest } from '../common/request.js';
import { CLASSROOMS } from './classrooms.js';
import type { Classroom, Classrooms } from './classrooms.js';

@Controller('v1/classes')
@UseGuards(JwtGuard)
export class ClassesController {
  constructor(@Inject(CLASSROOMS) private readonly classrooms: Classrooms) {}

  @Get()
  list(@Req() request: SubmissionRequest): Promise<Classroom[]> {
    return this.classrooms.listClasses(request.user!);
  }

  @Post()
  create(@Req() request: SubmissionRequest, @Body() body: unknown): Promise<Classroom> {
    if (request.user!.role !== 'admin')
      throw new Problem('forbidden-role', 'Only admins may create classes.');
    const value =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const code = typeof value.code === 'string' ? value.code.trim() : '';
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!code || code.length > 100 || !name || name.length > 200) {
      throw new Problem('validation-failed', 'A class code and name are required.', [
        { pointer: '', detail: 'code and name must be non-empty and within their length limits' },
      ]);
    }
    return this.classrooms.createClass(code, name);
  }
}
