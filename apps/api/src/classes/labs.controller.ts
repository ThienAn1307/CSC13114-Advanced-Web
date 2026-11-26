import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/auth.module.js';
import { Problem } from '../common/problem.js';
import { isUuid } from '../common/request.js';
import type { SubmissionRequest } from '../common/request.js';
import { LABS } from './labs.js';
import type { Labs, LabSummary, LabConstraint, LabTestCase } from './labs.js';

function parseLabDetails(value: Record<string, unknown>): {
  statement?: string;
  cpuLimitSeconds?: number;
  memoryLimitMb?: number;
  constraints?: Omit<LabConstraint, 'id'>[];
  testCases?: LabTestCase[];
} {
  const invalid = () =>
    new Problem('validation-failed', 'Invalid lab details.', [
      { pointer: '', detail: 'check statement, limits, constraints and test cases' },
    ]);
  const text = (input: unknown, max: number, allowEmpty = false): input is string =>
    typeof input === 'string' &&
    !input.includes('\0') &&
    Buffer.byteLength(input, 'utf8') <= max &&
    (allowEmpty || input.trim().length > 0);
  const statement = value.statement;
  const cpu = value.cpuLimitSeconds;
  const memory = value.memoryLimitMb;
  if (
    (statement !== undefined && !text(statement, 65536)) ||
    (cpu !== undefined &&
      (typeof cpu !== 'number' || !Number.isInteger(cpu) || cpu < 1 || cpu > 5)) ||
    (memory !== undefined &&
      (typeof memory !== 'number' || !Number.isInteger(memory) || memory < 64 || memory > 512))
  )
    throw invalid();
  let constraints: Omit<LabConstraint, 'id'>[] | undefined;
  if (value.constraints !== undefined) {
    if (
      !Array.isArray(value.constraints) ||
      value.constraints.length < 1 ||
      value.constraints.length > 50
    )
      throw invalid();
    constraints = value.constraints.map((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) throw invalid();
      const item = entry as Record<string, unknown>;
      if (
        !text(item.text, 4000) ||
        typeof item.deduction !== 'number' ||
        !Number.isFinite(item.deduction) ||
        item.deduction < 0 ||
        item.deduction > 10 ||
        Math.abs(item.deduction * 100 - Math.round(item.deduction * 100)) > 1e-8
      )
        throw invalid();
      return { text: item.text, deduction: item.deduction };
    });
  }
  let testCases: LabTestCase[] | undefined;
  if (value.testCases !== undefined) {
    if (
      !Array.isArray(value.testCases) ||
      value.testCases.length < 1 ||
      value.testCases.length > 50
    )
      throw invalid();
    testCases = value.testCases.map((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) throw invalid();
      const item = entry as Record<string, unknown>;
      if (!text(item.input, 65536, true) || !text(item.expectedOutput, 65536, true))
        throw invalid();
      return { input: item.input, expectedOutput: item.expectedOutput };
    });
  }
  return {
    ...(typeof statement === 'string' ? { statement } : {}),
    ...(typeof cpu === 'number' ? { cpuLimitSeconds: cpu } : {}),
    ...(typeof memory === 'number' ? { memoryLimitMb: memory } : {}),
    ...(constraints ? { constraints } : {}),
    ...(testCases ? { testCases } : {}),
  };
}

@Controller('v1/classes/:classId/labs')
@UseGuards(JwtGuard)
export class LabsController {
  constructor(@Inject(LABS) private readonly labs: Labs) {}

  @Get()
  async list(
    @Req() request: SubmissionRequest,
    @Param('classId') classId: string,
  ): Promise<LabSummary[]> {
    const result = isUuid(classId) ? await this.labs.list(request.user!, classId) : null;
    if (!result) throw new Problem('lab-not-found', 'Lab not found.');
    return result;
  }

  @Post()
  async create(
    @Req() request: SubmissionRequest,
    @Param('classId') classId: string,
    @Body() body: unknown,
  ): Promise<LabSummary> {
    if (request.user!.role !== 'ta')
      throw new Problem('forbidden-role', 'Only TAs may create labs.');
    const value =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const validTime = (time: unknown): time is string => {
      if (typeof time !== 'string') return false;
      const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(time);
      if (!match || !Number.isFinite(Date.parse(time))) return false;
      return new Date(time).toISOString() === `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
    };
    if (
      !isUuid(classId) ||
      !title ||
      title.length > 200 ||
      !validTime(value.opensAt) ||
      !validTime(value.deadlineAt) ||
      Date.parse(value.opensAt) >= Date.parse(value.deadlineAt)
    ) {
      throw new Problem('validation-failed', 'Invalid lab details.', [
        { pointer: '', detail: 'check title and UTC submission window' },
      ]);
    }
    const result = await this.labs.create(request.user!, classId, {
      title,
      opensAt: new Date(value.opensAt),
      deadlineAt: new Date(value.deadlineAt),
      ...parseLabDetails(value),
    });
    if (!result) throw new Problem('lab-not-found', 'Lab not found.');
    return result;
  }
}
