import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { judgeResults, judgeTestResults, submissions } from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { createApp } from '../src/app.js';
import { outboxOnlyQueue } from '../src/outbox-queue.js';
import { PostgresSubmissionData } from '../src/postgres-submission-data.js';
import { PostgresStudentSubmissions } from '../src/submissions/postgres-student-submissions.js';

const secret = randomBytes(32).toString('hex');
const submissionId = randomUUID();
let database: TestDatabase;
let app: NestExpressApplication;
let origin: string;
function token(id: string, role: 'student' | 'ta'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: id, role, exp: Math.floor(Date.now() / 1000) + 60 }),
  ).toString('base64url');
  const value = `${header}.${payload}`;
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}
beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
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
    .values({ submissionId, status: 'WA', finishedAt: new Date() });
  await database.db.insert(judgeTestResults).values([
    { submissionId, position: 1, status: 'AC' },
    { submissionId, position: 2, status: 'WA' },
  ]);
  app = await createApp({
    config: { jwtSecret: secret, port: 3000 },
    data: new PostgresSubmissionData(database),
    queue: outboxOnlyQueue,
    studentSubmissions: new PostgresStudentSubmissions(database.db),
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  await database?.drop();
});

it('returns only per-test verdicts for the student’s own submission', async () => {
  const url = `${origin}/v1/submissions/${submissionId}/tests`;
  const get = (id: string, role: 'student' | 'ta') =>
    fetch(url, { headers: { Authorization: `Bearer ${token(id, role)}` } });
  const own = await get(SEED.users.student, 'student');
  expect(own.status).toBe(200);
  expect(await own.json()).toEqual([
    { position: 1, status: 'AC' },
    { position: 2, status: 'WA' },
  ]);
  expect((await get(SEED.users.classmate, 'student')).status).toBe(404);
  expect((await get(SEED.users.ta, 'ta')).status).toBe(403);
});
