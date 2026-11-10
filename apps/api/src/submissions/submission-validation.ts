import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { isSourceTooLarge } from '../../../../packages/shared/src/index.js';
import { Problem } from '../common/problem.js';
import { CreateSubmissionDto } from './submission.dto.js';

export function validateSubmission(body: unknown): CreateSubmissionDto {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Problem('validation-failed', 'The body must be a JSON object.', [
      { pointer: '', detail: 'must be a JSON object' },
    ]);
  }
  const dto = plainToInstance(CreateSubmissionDto, {
    source: (body as Record<string, unknown>).source,
  });
  const errors = validateSync(dto).map((error) => ({
    pointer: `/${error.property.replaceAll('~', '~0').replaceAll('/', '~1')}`,
    detail: Object.values(error.constraints ?? {})
      .sort()
      .join('; '),
  }));
  if (errors.length) {
    throw new Problem(
      'validation-failed',
      `${errors.length} field${errors.length === 1 ? ' is' : 's are'} invalid.`,
      errors,
    );
  }
  if (isSourceTooLarge(dto.source))
    throw new Problem('source-too-large', 'The source exceeds 65,536 bytes.');
  return dto;
}

export function validateIdempotencyKey(value: string | string[] | undefined): string {
  if (value === undefined)
    throw new Problem('idempotency-key-missing', 'An Idempotency-Key header is required.');
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(value)) {
    throw new Problem(
      'idempotency-key-invalid',
      'The key must contain 1 to 255 visible ASCII characters.',
    );
  }
  return value;
}
