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

it('rejects proposals for non-Accepted submissions, other labs, and invented evidence', async () => {
  const accepted = randomUUID();
  const rejected = randomUUID();
  const localConstraint = randomUUID();
  const otherConstraint = randomUUID();
  await database.db.insert(labConstraints).values([
    {
      id: localConstraint,
      labId: SEED.labs.open,
      text: 'Use a loop',
      deductionHundredths: 100,
      position: 0,
    },
    {
      id: otherConstraint,
      labId: SEED.labs.otherClass,
      text: 'Another rule',
      deductionHundredths: 100,
      position: 0,
    },
  ]);
  await database.db.insert(submissions).values([
    {
      id: accepted,
      labId: SEED.labs.open,
      studentId: SEED.users.student,
      source: 'original',
      sizeBytes: 8,
      receivedAt: new Date(),
      status: 'queued',
    },
    {
      id: rejected,
      labId: SEED.labs.open,
      studentId: SEED.users.classmate,
      source: 'original',
      sizeBytes: 8,
      receivedAt: new Date(),
      status: 'queued',
    },
  ]);
  await database.db.insert(judgeResults).values([
    { submissionId: accepted, status: 'AC', finishedAt: new Date() },
    { submissionId: rejected, status: 'WA', finishedAt: new Date() },
  ]);
  const reviews = new PostgresReviewQueue(database.db);
  const proposal = {
    constraintId: localConstraint,
    verdict: 'violation' as const,
    evidence: [{ line: 1, text: 'original' }],
    decidedBy: 'model' as const,
  };
  await expect(reviews.storeProposals(rejected, [proposal])).rejects.toThrow();
  await expect(
    reviews.storeProposals(accepted, [{ ...proposal, constraintId: otherConstraint }]),
  ).rejects.toThrow();
  await expect(
    reviews.storeProposals(accepted, [{ ...proposal, evidence: [{ line: 1, text: 'invented' }] }]),
  ).rejects.toThrow();
  await expect(reviews.storeProposals(accepted, [{ ...proposal, evidence: [] }])).rejects.toThrow();
  expect(await reviews.list({ id: SEED.users.ta, role: 'ta' }, SEED.classes.sorting)).toEqual([]);
});
