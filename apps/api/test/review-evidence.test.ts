import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { judgeResults, labConstraints, submissions } from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { PostgresReviewQueue } from '../src/reviews/postgres-review-queue.js';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
});
afterAll(async () => {
  await database?.drop();
});

it('shows the TA’s selected evidence separately from the proposal evidence', async () => {
  const submissionId = randomUUID();
  const constraintId = randomUUID();
  const ta = { id: SEED.users.ta, role: 'ta' as const };
  await database.db.insert(labConstraints).values({
    id: constraintId,
    labId: SEED.labs.open,
    text: 'Rule',
    deductionHundredths: 100,
    position: 0,
  });
  await database.db.insert(submissions).values({
    id: submissionId,
    labId: SEED.labs.open,
    studentId: SEED.users.student,
    source: 'first\nsecond',
    sizeBytes: 12,
    receivedAt: new Date(),
    status: 'queued',
  });
  await database.db
    .insert(judgeResults)
    .values({ submissionId, status: 'AC', finishedAt: new Date() });
  const queue = new PostgresReviewQueue(database.db);
  await queue.storeProposals(submissionId, [
    {
      constraintId,
      verdict: 'violation',
      evidence: [{ line: 1, text: 'first' }],
      decidedBy: 'model',
    },
  ]);
  const [proposal] = (await queue.list(ta, SEED.classes.sorting))!;
  await queue.decide(ta, SEED.classes.sorting, proposal!.id, 'violation', [
    { line: 2, text: 'second' },
  ]);
  const [updated] = (await queue.list(ta, SEED.classes.sorting))!;
  expect(updated).toMatchObject({
    evidence: [{ line: 1, text: 'first' }],
    reviewEvidence: [{ line: 2, text: 'second' }],
  });
});
