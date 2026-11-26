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

it('hides an older proposal as soon as the student has a newer submission', async () => {
  const older = randomUUID();
  const newer = randomUUID();
  const constraintId = randomUUID();
  const now = Date.now();
  await database.db.insert(labConstraints).values({
    id: constraintId,
    labId: SEED.labs.open,
    text: 'Use a loop',
    deductionHundredths: 100,
    position: 0,
  });
  await database.db.insert(submissions).values([
    {
      id: older,
      labId: SEED.labs.open,
      studentId: SEED.users.student,
      source: 'old',
      sizeBytes: 3,
      receivedAt: new Date(now - 1000),
      status: 'queued',
    },
    {
      id: newer,
      labId: SEED.labs.open,
      studentId: SEED.users.student,
      source: 'new',
      sizeBytes: 3,
      receivedAt: new Date(now),
      status: 'queued',
    },
  ]);
  await database.db
    .insert(judgeResults)
    .values({ submissionId: older, status: 'AC', finishedAt: new Date() });
  const reviews = new PostgresReviewQueue(database.db);
  await reviews.storeProposals(older, [
    {
      constraintId,
      verdict: 'violation',
      evidence: [{ line: 1, text: 'old' }],
      decidedBy: 'model',
    },
  ]);
  expect(await reviews.list({ id: SEED.users.ta, role: 'ta' }, SEED.classes.sorting)).toEqual([]);
});
