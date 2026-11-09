import type { Request } from 'express';

export interface Principal {
  id: string;
  role: 'student' | 'ta' | 'admin';
}

export interface SubmissionRequest extends Request {
  receivedAt: Date;
  user?: Principal;
}

// UUID syntax rather than version restrictions; contract accepts UUIDs in either case.
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
  );
}
