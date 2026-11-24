import type { SubmissionQueue } from './submissions/submission-data.js';

/**
 * The submission row is the job (decisions.md D11): the judge worker claims `queued` rows from
 * PostgreSQL itself (`JudgeQueue` in packages/db), so the API has nothing to enqueue and this
 * never fails. The contract's queue boundary (section 4.7) stays, for the tests that replace it.
 */
export const outboxOnlyQueue: SubmissionQueue = {
  enqueue: () => Promise.resolve(),
};
