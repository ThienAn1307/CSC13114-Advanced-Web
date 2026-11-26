import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { judgeResults, labConstraints, submissions } from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { createApp } from '../src/app.js';
import { PostgresReviewQueue } from '../src/reviews/postgres-review-queue.js';
import { outboxOnlyQueue } from '../src/outbox-queue.js';
import { PostgresSubmissionData } from '../src/postgres-submission-data.js';

const signingMaterial = randomBytes(32).toString('hex');
const submissionId = randomUUID();
const constraintId = randomUUID();
let database: TestDatabase;
let reviews: PostgresReviewQueue;
let app: NestExpressApplication;
let origin: string;

function token(id: string, role: 'student' | 'ta'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: id, role, exp: Math.floor(Date.now() / 1000) + 60 }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', signingMaterial).update(input).digest('base64url')}`;
}

beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
  await database.db.insert(labConstraints).values({
    id: constraintId,
    labId: SEED.labs.open,
    text: 'Use a loop',
    deductionHundredths: 125,
    position: 0,
  });
  await database.db.insert(submissions).values({
    id: submissionId,
    labId: SEED.labs.open,
    studentId: SEED.users.student,
    source: 'int main() {}',
    sizeBytes: 13,
    receivedAt: new Date(),
    status: 'queued',
  });
  await database.db
    .insert(judgeResults)
    .values({ submissionId, status: 'AC', finishedAt: new Date() });
  reviews = new PostgresReviewQueue(database.db);
  app = await createApp({
    config: { jwtSecret: signingMaterial, port: 3000 },
    data: new PostgresSubmissionData(database),
    queue: outboxOnlyQueue,
    reviews,
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  await database?.drop();
});

it('stores an Accepted submission proposal and shows it only to a TA of that class', async () => {
  await reviews.storeProposals(submissionId, [
    {
      constraintId,
      verdict: 'violation',
      evidence: [{ line: 1, text: 'int main() {}' }],
      decidedBy: 'model',
      reason: 'The loop is missing.',
    },
  ]);
  const url = `${origin}/v1/classes/${SEED.classes.sorting}/reviews`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token(SEED.users.ta, 'ta')}` },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject([
    { submissionId, constraintId, verdict: 'violation', deduction: 1.25, decision: null },
  ]);
  expect(
    (
      await fetch(url, {
        headers: { Authorization: `Bearer ${token(SEED.users.student, 'student')}` },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${origin}/v1/classes/${SEED.classes.other}/reviews`, {
        headers: { Authorization: `Bearer ${token(SEED.users.ta, 'ta')}` },
      })
    ).status,
  ).toBe(404);
});
