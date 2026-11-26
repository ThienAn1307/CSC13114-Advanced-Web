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

const material = randomBytes(32).toString('hex');
const submissionId = randomUUID();
const constraintId = randomUUID();
let database: TestDatabase;
let reviews: PostgresReviewQueue;
let app: NestExpressApplication;
let origin: string;
function token(id: string, role: 'ta' | 'student'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: id, role, exp: Math.floor(Date.now() / 1000) + 60 }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', material).update(input).digest('base64url')}`;
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
  await reviews.storeProposals(submissionId, [
    {
      constraintId,
      verdict: 'unsure',
      evidence: [],
      unsureCause: 'timeout',
      decidedBy: 'guardrail',
    },
  ]);
  app = await createApp({
    config: { jwtSecret: material, port: 3000 },
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

it('requires a TA’s explicit decision and evidence for a violation', async () => {
  const ta = token(SEED.users.ta, 'ta');
  const queueUrl = `${origin}/v1/classes/${SEED.classes.sorting}/reviews`;
  const queue = (await (
    await fetch(queueUrl, { headers: { Authorization: `Bearer ${ta}` } })
  ).json()) as { id: string; decision: string | null }[];
  expect(queue[0]?.decision).toBeNull();
  const url = `${queueUrl}/${queue[0]!.id}/decision`;
  const decide = (authorization: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization}` },
      body: JSON.stringify(body),
    });
  expect((await decide(ta, { decision: 'violation', evidence: [] })).status).toBe(422);
  expect(
    (await decide(ta, { decision: 'violation', evidence: [{ line: 1, text: 'invented' }] })).status,
  ).toBe(422);
  expect(
    (await decide(token(SEED.users.student, 'student'), { decision: 'pass', evidence: [] })).status,
  ).toBe(403);
  const accepted = await decide(ta, {
    decision: 'violation',
    evidence: [{ line: 1, text: 'int main() {}' }],
  });
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({ decision: 'violation' });
  const updated = (await (
    await fetch(queueUrl, { headers: { Authorization: `Bearer ${ta}` } })
  ).json()) as { decision: string | null }[];
  expect(updated[0]?.decision).toBe('violation');
});
