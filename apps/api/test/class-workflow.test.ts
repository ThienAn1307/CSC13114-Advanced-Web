import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { createApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/auth/bootstrap-admin.js';
import { PostgresAccounts } from '../src/auth/postgres-accounts.js';
import { PostgresClassrooms } from '../src/classes/postgres-classrooms.js';
import { PostgresLabs } from '../src/classes/postgres-labs.js';
import { PostgresMembers } from '../src/classes/postgres-members.js';
import { outboxOnlyQueue } from '../src/outbox-queue.js';
import { PostgresSubmissionData } from '../src/postgres-submission-data.js';
import { PostgresStudentSubmissions } from '../src/submissions/postgres-student-submissions.js';

let database: TestDatabase;
let app: NestExpressApplication;
let origin: string;
const password = 'example passphrase';

beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
  await bootstrapAdmin(database.db, 'admin@leetkob.test', 'Admin', password);
  app = await createApp({
    config: { jwtSecret: randomBytes(32).toString('hex'), port: 3000 },
    data: new PostgresSubmissionData(database),
    queue: outboxOnlyQueue,
    accounts: new PostgresAccounts(database.db),
    classrooms: new PostgresClassrooms(database.db),
    members: new PostgresMembers(database.db),
    labs: new PostgresLabs(database.db),
    studentSubmissions: new PostgresStudentSubmissions(database.db),
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  await database?.drop();
});

async function call(
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signIn(email: string): Promise<string> {
  const response = await call('/v1/auth/login', undefined, { email, password });
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

it('supports a complete admin, TA and student submission flow without crossing class boundaries', async () => {
  const admin = await signIn('admin@leetkob.test');
  const createdClass = await call('/v1/classes', admin, {
    code: 'WORKFLOW',
    name: 'Workflow class',
  });
  expect(createdClass.status).toBe(201);
  const classroom = (await createdClass.json()) as { id: string };
  expect(
    (
      await call(`/v1/classes/${classroom.id}/tas`, admin, {
        email: 'workflow-ta@leetkob.test',
        displayName: 'TA',
        password,
      })
    ).status,
  ).toBe(201);
  const ta = await signIn('workflow-ta@leetkob.test');
  expect((await call(`/v1/classes/${SEED.classes.other}/labs`, ta)).status).toBe(404);
  expect(
    (
      await call(`/v1/classes/${SEED.classes.other}/students`, ta, {
        email: 'unauthorized@leetkob.test',
        displayName: 'Student',
        password,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(`/v1/classes/${classroom.id}/students`, ta, {
        email: 'workflow-student@leetkob.test',
        displayName: 'Student',
        password,
      })
    ).status,
  ).toBe(201);
  const now = Date.now();
  const createdLab = await call(`/v1/classes/${classroom.id}/labs`, ta, {
    title: 'Lab',
    opensAt: new Date(now - 60000).toISOString(),
    deadlineAt: new Date(now + 60000).toISOString(),
  });
  expect(createdLab.status).toBe(201);
  const lab = (await createdLab.json()) as { id: string };
  const student = await signIn('workflow-student@leetkob.test');
  expect((await call(`/v1/classes/${classroom.id}/labs`, student)).status).toBe(200);
  expect(
    (await call(`/v1/classes/${classroom.id}/labs`, student, { title: 'forbidden' })).status,
  ).toBe(403);
  const submission = await call(
    `/v1/labs/${lab.id}/submissions`,
    student,
    { source: 'int main() {}' },
    { 'Idempotency-Key': 'workflow' },
  );
  expect(submission.status).toBe(202);
  const receipt = (await submission.json()) as { id: string };
  const statuses = await call('/v1/submissions', student);
  expect(statuses.status).toBe(200);
  expect(await statuses.json()).toMatchObject([{ id: receipt.id, status: 'queued' }]);
  expect((await call('/v1/submissions', ta)).status).toBe(403);
});
