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

it('uses the TA’s configured deduction and never a value supplied with a model proposal', async () => {
  const submissionId = randomUUID();
  const constraintId = randomUUID();
  await database.db.insert(labConstraints).values({
    id: constraintId,
    labId: SEED.labs.open,
    text: 'Rule',
    deductionHundredths: 125,
    position: 0,
  });
  await database.db.insert(submissions).values({
    id: submissionId,
    labId: SEED.labs.open,
    studentId: SEED.users.student,
    source: 'source',
    sizeBytes: 6,
    receivedAt: new Date(),
    status: 'queued',
  });
  await database.db
    .insert(judgeResults)
    .values({ submissionId, status: 'AC', finishedAt: new Date() });
  const queue = new PostgresReviewQueue(database.db);
  const proposal = {
    constraintId,
    verdict: 'violation' as const,
    evidence: [{ line: 1, text: 'source' }],
    decidedBy: 'model' as const,
    deduction: 10,
  };
  await queue.storeProposals(submissionId, [proposal]);
  const [visible] = (await queue.list({ id: SEED.users.ta, role: 'ta' }, SEED.classes.sorting))!;
  expect(visible?.deduction).toBe(1.25);
  expect(visible?.decision).toBeNull();
});
