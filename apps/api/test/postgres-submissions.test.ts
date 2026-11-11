import { createHmac, randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { idempotencyKeys, submissions } from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { createApp } from '../src/app.js';
import { outboxOnlyQueue } from '../src/outbox-queue.js';
import { PostgresSubmissionData } from '../src/postgres-submission-data.js';

// The composition root's pieces wired together: HTTP -> X's API -> Y's adapter -> PostgreSQL.
// These tests check the wiring and what only a real database shows; the HTTP contract itself
// is covered by the contract tests and by submissions.test.ts.

const signingMaterial = randomBytes(32).toString('hex');
const { users: U, labs: L } = SEED;
let database: TestDatabase;
let app: NestExpressApplication;
let origin: string;

function token(sub: string = U.student): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub, role: 'student', exp: Date.now() / 1000 + 3600 }),
  ).toString('base64url');
  const value = `${header}.${payload}`;
  return `${value}.${createHmac('sha256', signingMaterial).update(value).digest('base64url')}`;
}

function post(
  options: { labId?: string; key?: string; source?: string; sub?: string } = {},
): Promise<Response> {
  return fetch(`${origin}/v1/labs/${options.labId ?? L.open}/submissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token(options.sub)}`,
      'Idempotency-Key': options.key ?? 'key-1',
    },
    body: JSON.stringify({ source: options.source ?? 'int main() { return 0; }\n' }),
  });
}

async function expectProblem(response: Response, status: number, slug: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  expect(await response.json()).toMatchObject({
    type: `https://leetkob.example/problems/${slug}`,
    status,
  });
}

async function rows() {
  const [s] = await database.db.select({ n: count() }).from(submissions);
  const [k] = await database.db.select({ n: count() }).from(idempotencyKeys);
  return { submissions: s?.n ?? -1, keys: k?.n ?? -1 };
}

beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
  app = await createApp({
    config: { jwtSecret: signingMaterial, port: 3000 },
    data: new PostgresSubmissionData(database),
    queue: outboxOnlyQueue,
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  await database?.drop();
});

beforeEach(async () => {
  await database.db.delete(idempotencyKeys);
  await database.db.delete(submissions);
});

describe('submissions through PostgreSQL', () => {
  it('stores the submission as queued, owned by the token subject, and returns its receipt', async () => {
    const response = await post();

    expect(response.status).toBe(202);
    const receipt = (await response.json()) as Record<string, unknown>;
    expect(response.headers.get('location')).toBe(`/v1/submissions/${String(receipt.id)}`);
    const [row] = await database.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, String(receipt.id)));
    expect(row).toMatchObject({ studentId: U.student, labId: L.open, status: 'queued' });
    expect(row?.receivedAt.toISOString()).toBe(receipt.receivedAt);
    expect(await rows()).toEqual({ submissions: 1, keys: 1 });
  });

  it('replays a retry with the same key and body from the database, creating nothing', async () => {
    const first = (await (await post()).json()) as Record<string, unknown>;

    const retry = await post();

    expect(retry.status).toBe(202);
    expect(retry.headers.get('idempotent-replayed')).toBe('true');
    expect(await retry.json()).toEqual(first);
    expect(await rows()).toEqual({ submissions: 1, keys: 1 });
  });

  it('refuses the same key with a different body and keeps the first submission', async () => {
    await post();
    await expectProblem(
      await post({ source: 'int main() { return 1; }\n' }),
      422,
      'idempotency-key-reused',
    );
    expect(await rows()).toEqual({ submissions: 1, keys: 1 });
  });

  it('answers a lab of another class exactly like a lab that does not exist', async () => {
    await expectProblem(await post({ labId: L.otherClass }), 404, 'lab-not-found');
    await expectProblem(
      await post({ labId: '00000000-0000-4000-8000-00000000ffff' }),
      404,
      'lab-not-found',
    );
    await expectProblem(await post({ sub: U.otherStudent }), 404, 'lab-not-found');
    expect(await rows()).toEqual({ submissions: 0, keys: 0 });
  });

  it('reads the lab window from the database', async () => {
    await expectProblem(await post({ labId: L.notOpen }), 409, 'lab-not-open');
    await expectProblem(await post({ labId: L.closed }), 409, 'lab-closed');
    expect(await rows()).toEqual({ submissions: 0, keys: 0 });
  });

  it('creates one submission when the same request arrives eight times at once', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => post()));

    const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ id: string }>));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(202));
    expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
    expect(responses.filter((r) => !r.headers.has('idempotent-replayed'))).toHaveLength(1);
    expect(await rows()).toEqual({ submissions: 1, keys: 1 });
  });
});

describe('shutdown', () => {
  it('closes the database pool when the app closes', async () => {
    const own = await createTestDatabase();
    try {
      const ownApp = await createApp({
        config: { jwtSecret: signingMaterial, port: 3000 },
        data: new PostgresSubmissionData(own),
        queue: outboxOnlyQueue,
      });
      await ownApp.close();
      expect(own.pool.ending).toBe(true);
    } finally {
      await own.drop();
    }
  });
});
