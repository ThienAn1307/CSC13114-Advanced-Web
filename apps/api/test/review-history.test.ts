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

it('retains the previous and new decision in order when a TA changes a review', async () => {
  const submissionId = randomUUID();
  const constraintId = randomUUID();
  const principal = { id: SEED.users.ta, role: 'ta' as const };
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
    source: 'source',
    sizeBytes: 6,
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
      verdict: 'unsure',
      evidence: [],
      unsureCause: 'timeout',
      decidedBy: 'guardrail',
    },
  ]);
  const [proposal] = (await queue.list(principal, SEED.classes.sorting))!;
  await queue.decide(principal, SEED.classes.sorting, proposal!.id, 'pass', []);
  await queue.decide(principal, SEED.classes.sorting, proposal!.id, 'violation', [
    { line: 1, text: 'source' },
  ]);
  const [updated] = (await queue.list(principal, SEED.classes.sorting))!;
  expect(updated).toMatchObject({
    decision: 'violation',
    history: [
      { reviewerId: principal.id, previousDecision: null, decision: 'pass' },
      { reviewerId: principal.id, previousDecision: 'pass', decision: 'violation' },
    ],
  });
});
