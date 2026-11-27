import { createHmac, randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { createApp } from '../src/app.js';
import { PostgresLabs } from '../src/classes/postgres-labs.js';
import { outboxOnlyQueue } from '../src/outbox-queue.js';
import { PostgresSubmissionData } from '../src/postgres-submission-data.js';

const signingMaterial = randomBytes(32).toString('hex');
let database: TestDatabase;
let app: NestExpressApplication;
let origin: string;
function token(id: string, role: 'ta' | 'student'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: id, role, exp: Math.floor(Date.now() / 1000) + 60 }),
  ).toString('base64url');
  const value = `${header}.${payload}`;
  return `${value}.${createHmac('sha256', signingMaterial).update(value).digest('base64url')}`;
}
beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
  app = await createApp({
    config: { jwtSecret: signingMaterial, port: 3000 },
    data: new PostgresSubmissionData(database),
    queue: outboxOnlyQueue,
    labs: new PostgresLabs(database.db),
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  await database?.drop();
});

it('stores a TA’s configured lab and never returns its hidden tests to a student', async () => {
  const url = `${origin}/v1/classes/${SEED.classes.sorting}/labs`;
  const now = Date.now();
  const ta = token(SEED.users.ta, 'ta');
  const student = token(SEED.users.student, 'student');
  const created = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ta}` },
    body: JSON.stringify({
      title: 'Configured lab',
      statement: 'Add numbers',
      opensAt: new Date(now - 1000).toISOString(),
      deadlineAt: new Date(now + 60000).toISOString(),
      cpuLimitSeconds: 2,
      memoryLimitMb: 128,
      constraints: [{ text: 'Use a loop', deduction: 1.25 }],
      testCases: [{ input: 'private input', expectedOutput: 'private output' }],
    }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const response = await fetch(url, { headers: { Authorization: `Bearer ${student}` } });
  expect(response.status).toBe(200);
  const rows = (await response.json()) as { id: string }[];
  const visible = rows.find((row) => row.id === id);
  expect(visible).toMatchObject({
    statement: 'Add numbers',
    constraints: [{ text: 'Use a loop', deduction: 1.25 }],
  });
  expect(JSON.stringify(visible)).not.toContain('private input');
  expect(JSON.stringify(visible)).not.toContain('private output');
});
