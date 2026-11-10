import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

// Slugs, statuses and titles come exclusively from the HTTP contract, section 2.
const problems = {
  'malformed-json': [400, 'Malformed JSON'],
  'idempotency-key-missing': [400, 'Idempotency-Key required'],
  'idempotency-key-invalid': [400, 'Invalid Idempotency-Key'],
  unauthenticated: [401, 'Authentication required'],
  'forbidden-role': [403, 'Role not allowed'],
  'lab-not-found': [404, 'Lab not found'],
  'lab-not-open': [409, 'Lab not open yet'],
  'lab-closed': [409, 'Lab closed'],
  'source-too-large': [413, 'Source too large'],
  'unsupported-media-type': [415, 'Unsupported media type'],
  'idempotency-key-reused': [422, 'Idempotency-Key reused'],
  'validation-failed': [422, 'Invalid request body'],
  internal: [500, 'Internal error'],
} as const;

export interface FieldError {
  pointer: string;
  detail: string;
}

export class Problem extends HttpException {
  constructor(slug: keyof typeof problems, detail: string, errors?: FieldError[]) {
    const [status, title] = problems[slug];
    super(
      {
        type: `https://leetkob.example/problems/${slug}`,
        title,
        status,
        detail,
        ...(slug === 'validation-failed' ? { errors: errors ?? [] } : {}),
      },
      status,
    );
  }
}

export function internalProblem(): Problem {
  return new Problem('internal', 'The request could not be completed.');
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const problem = error instanceof Problem ? error : internalProblem();
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    if (problem.getStatus() === 401) response.setHeader('WWW-Authenticate', 'Bearer');
    response
      .status(problem.getStatus())
      .type('application/problem+json')
      .json(problem.getResponse());
  }
}
