import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { users } from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { PostgresAccounts } from '../src/auth/postgres-accounts.js';
import { outboxOnlyQueue } from '../src/outbox-queue.js';
import { PostgresSubmissionData } from '../src/postgres-submission-data.js';

let database: TestDatabase;
let app: NestExpressApplication;
let origin: string;

beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
  await database.db
    .update(users)
    .set({ passwordHash: await hashPassword('example password') })
    .where(eq(users.id, SEED.users.student));
  app = await createApp({
    config: { jwtSecret: randomBytes(32).toString('hex'), port: 3000 },
    data: new PostgresSubmissionData(database),
    queue: outboxOnlyQueue,
    accounts: new PostgresAccounts(database.db),
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  await database?.drop();
});

it('authenticates a persisted account while seeded accounts without a password cannot sign in', async () => {
  async function login(email: string): Promise<Response> {
    return fetch(`${origin}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'example password' }),
    });
  }
  const accepted = await login('STUDENT@LEETKOB.TEST');
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toHaveProperty('accessToken');
  expect((await login('admin@leetkob.test')).status).toBe(401);
});

it('rejects case-insensitive email collisions instead of choosing an account', async () => {
  await database.db
    .update(users)
    .set({ email: 'STUDENT@leetkob.test', passwordHash: await hashPassword('example password') })
    .where(eq(users.id, SEED.users.classmate));
  const response = await fetch(`${origin}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@leetkob.test', password: 'example password' }),
  });
  expect(response.status).toBe(401);
});
