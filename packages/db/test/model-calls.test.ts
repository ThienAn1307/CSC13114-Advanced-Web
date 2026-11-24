import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { ModelCallLog } from '../src/model-calls.js';
import type { CallStart } from '../src/model-calls.js';
import { labConstraints, modelCalls, submissions } from '../src/schema.js';
import { SEED, seed } from '../src/seed.js';
import { createTestDatabase } from './test-database.js';
import type { TestDatabase } from './test-database.js';

// decisions.md D14 (one row per call) and D8 (a maximum number of model calls per lab).
let database: TestDatabase;
let log: ModelCallLog;
const constraints = { open: randomUUID(), closed: randomUUID() };

beforeAll(async () => {
  database = await createTestDatabase();
  log = new ModelCallLog(database.db);
  await seed(database.db, new Date());
  for (const lab of ['open', 'closed'] as const) {
    await database.db.insert(labConstraints).values({
      id: constraints[lab],
      labId: SEED.labs[lab],
      text: 'Use recursion.',
      deductionHundredths: 100,
      position: 1,
    });
  }
});

afterAll(async () => {
  await database?.drop();
});

beforeEach(async () => {
  await database.db.delete(modelCalls);
  await database.db.delete(submissions);
});

async function start(lab: 'open' | 'closed' = 'open'): Promise<CallStart> {
  const submissionId = randomUUID();
  await database.db.insert(submissions).values({
    id: submissionId,
    labId: SEED.labs[lab],
    studentId: SEED.users.student,
    source: 'int main() {}',
    sizeBytes: 13,
    receivedAt: new Date(),
  });
  return {
    submissionId,
    labId: SEED.labs[lab],
    constraintId: constraints[lab],
    attempt: 1,
    model: 'fake-model',
    prompt: 'the prompt',
  };
}

it('writes the row before the call, so a call cut short by a crash still counts', async () => {
  const call = await start();
  expect(await log.start(call, 1)).not.toBeNull();
  expect(await database.db.select().from(modelCalls)).toMatchObject([
    { ...call, outcome: 'started', requestId: null, tokensIn: null, ms: null },
  ]);
  expect(await log.start(await start(), 1)).toBeNull();
});

it('fills in what the provider answered', async () => {
  const id = (await log.start(await start(), 5))!;
  const answer = {
    model: 'fake-model-001',
    requestId: 'req-1',
    tokensIn: 700,
    tokensOut: 100,
    costNanoUsd: 325_000,
    ms: 1234,
    outcome: 'answered' as const,
  };
  await log.finish(id, answer);
  const [row] = await database.db.select().from(modelCalls).where(eq(modelCalls.id, id));
  expect(row).toMatchObject({ ...answer, prompt: 'the prompt', error: null });
});

it('refuses a call over the cap and writes no row for it', async () => {
  for (let i = 0; i < 3; i++) expect(await log.start(await start(), 3)).not.toBeNull();
  expect(await log.start(await start(), 3)).toBeNull();
  expect(await database.db.select().from(modelCalls)).toHaveLength(3);
});

it('counts each lab on its own', async () => {
  expect(await log.start(await start('open'), 1)).not.toBeNull();
  expect(await log.start(await start('closed'), 1)).not.toBeNull();
});

it('lets through exactly the cap when eight calls start at the same moment', async () => {
  const calls = await Promise.all(Array.from({ length: 8 }, () => start()));
  const gate = await database.pool.connect();
  let ids;
  try {
    await gate.query('begin');
    // Blocks the inserts but not the counts: without a lock per lab all eight would count zero.
    await gate.query('lock table model_calls in share mode');
    const pending = Promise.all(calls.map((call) => log.start(call, 3)));
    const deadline = Date.now() + 10_000;
    for (;;) {
      await gate.query('select pg_stat_clear_snapshot()');
      const { rows } = await gate.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
         where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`,
      );
      if (rows[0]!.n >= 8) break;
      if (Date.now() > deadline) throw new Error(`only ${rows[0]!.n} of 8 calls blocked`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await gate.query('commit');
    ids = await pending;
  } finally {
    gate.release();
  }
  expect(ids.filter(Boolean)).toHaveLength(3);
});
