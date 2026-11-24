import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CheckQueue, JudgeQueue } from '../src/job-queue.js';
import type { Claim, JudgeOutcome } from '../src/job-queue.js';
import type { ReviewProposal } from '../src/review-queue.js';
import {
  checkJobs,
  idempotencyKeys,
  judgeResults,
  judgeTestResults,
  labConstraints,
  reviewProposals,
  submissions,
} from '../src/schema.js';
import { SEED, seed } from '../src/seed.js';
import { createTestDatabase } from './test-database.js';
import type { TestDatabase } from './test-database.js';

// decisions.md D11 (the judge queue) and D12 (check_jobs).
const NOW = new Date('2026-11-24T14:00:00.000Z');
const LEASE_MS = 60_000;
const CONSTRAINT = '00000000-0000-4000-8000-00000000d001';
const ACCEPTED: JudgeOutcome = { status: 'AC', tests: ['AC', 'AC'] };
const PROPOSAL: ReviewProposal = {
  constraintId: CONSTRAINT,
  verdict: 'violation',
  evidence: [{ line: 1, text: 'int main() {}' }],
  decidedBy: 'hard-rule',
};

let database: TestDatabase;
let judge: JudgeQueue;
let check: CheckQueue;

beforeAll(async () => {
  database = await createTestDatabase();
  judge = new JudgeQueue(database.db);
  check = new CheckQueue(database.db);
  await seed(database.db, NOW);
  await database.db.insert(labConstraints).values({
    id: CONSTRAINT,
    labId: SEED.labs.open,
    text: 'Do not use `goto`.',
    deductionHundredths: 100,
    position: 1,
  });
});

afterAll(async () => {
  await database?.drop();
});

beforeEach(async () => {
  await database.db.delete(reviewProposals);
  await database.db.delete(checkJobs);
  await database.db.delete(judgeTestResults);
  await database.db.delete(judgeResults);
  await database.db.delete(idempotencyKeys);
  await database.db.delete(submissions);
});

async function submit(offsetMs = 0): Promise<string> {
  const id = randomUUID();
  await database.db.insert(submissions).values({
    id,
    labId: SEED.labs.open,
    studentId: SEED.users.student,
    source: 'int main() {}',
    sizeBytes: 13,
    status: 'queued',
    receivedAt: new Date(NOW.getTime() + offsetMs),
  });
  return id;
}

async function row(id: string) {
  const [found] = await database.db.select().from(submissions).where(eq(submissions.id, id));
  return found!;
}

async function job(id: string) {
  const [found] = await database.db.select().from(checkJobs).where(eq(checkJobs.submissionId, id));
  return found!;
}

/** The worker died: its lease has run out on the database's clock. */
async function expireLease(id: string): Promise<void> {
  const past = sql`now() - interval '1 second'`;
  await database.db.update(submissions).set({ leaseUntil: past }).where(eq(submissions.id, id));
}

async function expireCheckLease(id: string): Promise<void> {
  const past = sql`now() - interval '1 second'`;
  await database.db
    .update(checkJobs)
    .set({ leaseUntil: past })
    .where(eq(checkJobs.submissionId, id));
}

async function claimed(queue: JudgeQueue | CheckQueue): Promise<Claim> {
  const claim = await queue.claim(LEASE_MS);
  if (!claim) throw new Error('expected a claim');
  return claim;
}

async function accepted(): Promise<string> {
  const id = await submit();
  expect(await judge.complete(await claimed(judge), ACCEPTED)).toBe(true);
  return id;
}

async function waitForBlockedBackends(client: PoolClient, n: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    await client.query('select pg_stat_clear_snapshot()');
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.n ?? 0) >= n) return;
    if (Date.now() > deadline) throw new Error(`only ${rows[0]?.n ?? 0} of ${n} claims blocked`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('JudgeQueue.claim', () => {
  it('returns null when there is nothing to judge', async () => {
    expect(await judge.claim(LEASE_MS)).toBeNull();
  });

  it('marks the oldest queued row judging, with a lease, a token and one attempt', async () => {
    await submit(1000);
    const oldest = await submit(0);
    const claim = await claimed(judge);
    expect(claim).toMatchObject({ submissionId: oldest, attempts: 1 });
    const stored = await row(oldest);
    expect(stored).toMatchObject({ status: 'judging', attempts: 1, claimToken: claim.token });
    const { rows } = await database.pool.query<{ ok: boolean }>(
      `select lease_until > now() + interval '50 seconds'
          and lease_until <= now() + interval '60 seconds' as ok from submissions where id = $1`,
      [oldest],
    );
    expect(rows[0]?.ok).toBe(true);
  });

  it('gives one row to exactly one of eight workers that claim at the same moment', async () => {
    await submit();
    const gate = await database.pool.connect();
    let results;
    try {
      await gate.query('begin');
      await gate.query('lock table submissions in exclusive mode');
      const pending = Promise.all(Array.from({ length: 8 }, () => judge.claim(LEASE_MS)));
      await waitForBlockedBackends(gate, 8);
      await gate.query('commit');
      results = await pending;
    } finally {
      gate.release();
    }
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('skips a row another worker holds locked instead of waiting for it', async () => {
    const locked = await submit(0);
    const free = await submit(1000);
    const other = await database.pool.connect();
    try {
      await other.query('begin');
      await other.query('select id from submissions where id = $1 for update', [locked]);
      expect((await claimed(judge)).submissionId).toBe(free);
    } finally {
      await other.query('rollback');
      other.release();
    }
  });

  it('does not claim a row whose lease is still running', async () => {
    await submit();
    await claimed(judge);
    expect(await judge.claim(LEASE_MS)).toBeNull();
  });

  it('claims a row again, with a new token, when its lease ran out', async () => {
    const id = await submit();
    const first = await claimed(judge);
    await expireLease(id);
    const second = await claimed(judge);
    expect(second).toMatchObject({ submissionId: id, attempts: 2 });
    expect(second.token).not.toBe(first.token);
  });

  it('fails a row after 3 claims, with its cause, and goes on to the next row', async () => {
    const poison = await submit(0);
    for (let i = 0; i < 3; i++) {
      expect((await claimed(judge)).submissionId).toBe(poison);
      await expireLease(poison);
    }
    const next = await submit(1000);
    expect((await claimed(judge)).submissionId).toBe(next);
    expect(await row(poison)).toMatchObject({
      status: 'failed',
      attempts: 3,
      failureCause: 'worker-lost',
      claimToken: null,
      leaseUntil: null,
    });
  });
});

describe('JudgeQueue.renew', () => {
  it('extends the lease of the worker that holds the claim', async () => {
    const id = await submit();
    const claim = await claimed(judge);
    await expireLease(id);
    expect(await judge.renew(claim, LEASE_MS)).toBe(true);
    expect(await judge.claim(LEASE_MS)).toBeNull();
  });

  it('refuses a worker whose row was claimed by another one', async () => {
    const id = await submit();
    const stale = await claimed(judge);
    await expireLease(id);
    await claimed(judge);
    expect(await judge.renew(stale, LEASE_MS)).toBe(false);
  });
});

describe('JudgeQueue.complete', () => {
  it('writes the result, one row per test and the check job, and ends the claim', async () => {
    const id = await submit();
    const outcome: JudgeOutcome = { status: 'AC', tests: ['AC', 'AC'] };
    expect(await judge.complete(await claimed(judge), outcome)).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'judged', claimToken: null, leaseUntil: null });
    expect(await database.db.select().from(judgeResults)).toMatchObject([
      { submissionId: id, status: 'AC' },
    ]);
    const tests = await database.db
      .select()
      .from(judgeTestResults)
      .orderBy(judgeTestResults.position);
    expect(tests).toEqual([
      { submissionId: id, position: 1, status: 'AC' },
      { submissionId: id, position: 2, status: 'AC' },
    ]);
    expect(await job(id)).toMatchObject({ status: 'queued', attempts: 0 });
    expect(await judge.claim(LEASE_MS)).toBeNull();
  });

  it.each<JudgeOutcome>([
    { status: 'WA', tests: ['AC', 'WA'] },
    { status: 'CE', tests: [] },
  ])('makes no check job for $status: only Accepted is checked (FAQ-04)', async (outcome) => {
    await submit();
    expect(await judge.complete(await claimed(judge), outcome)).toBe(true);
    expect(await database.db.select().from(checkJobs)).toEqual([]);
  });

  it('writes nothing for a worker whose row was claimed by another one', async () => {
    const id = await submit();
    const stale = await claimed(judge);
    await expireLease(id);
    const current = await claimed(judge);
    expect(await judge.complete(stale, { status: 'WA', tests: ['WA'] })).toBe(false);
    expect(await database.db.select().from(judgeResults)).toEqual([]);
    expect(await judge.complete(current, ACCEPTED)).toBe(true);
    expect(await judge.complete(current, ACCEPTED)).toBe(false);
    expect(await database.db.select().from(judgeResults)).toMatchObject([{ status: 'AC' }]);
    expect(await database.db.select().from(checkJobs)).toHaveLength(1);
  });

  it('rolls everything back when a test result cannot be written', async () => {
    const id = await submit();
    const claim = await claimed(judge);
    const broken = { status: 'WA', tests: ['AC', 'nonsense'] } as unknown as JudgeOutcome;
    await expect(judge.complete(claim, broken)).rejects.toThrow();
    expect(await row(id)).toMatchObject({ status: 'judging', claimToken: claim.token });
    expect(await database.db.select().from(judgeResults)).toEqual([]);
  });
});

describe('JudgeQueue.giveUp', () => {
  it('keeps the row for a later try, not before the delay, and ends the claim', async () => {
    const id = await submit();
    const claim = await claimed(judge);
    expect(await judge.giveUp(claim, 'sandbox-error', LEASE_MS)).toBe('retry');
    expect(await judge.claim(LEASE_MS)).toBeNull();
    expect(await judge.complete(claim, ACCEPTED)).toBe(false);
    await expireLease(id);
    expect(await claimed(judge)).toMatchObject({ submissionId: id, attempts: 2 });
  });

  it('fails the row with its cause on the third claim', async () => {
    const id = await submit();
    for (let i = 1; i <= 3; i++) {
      const claim = await claimed(judge);
      expect(await judge.giveUp(claim, 'sandbox-error', LEASE_MS)).toBe(i < 3 ? 'retry' : 'failed');
      if (i < 3) await expireLease(id);
    }
    expect(await row(id)).toMatchObject({ status: 'failed', failureCause: 'sandbox-error' });
    expect(await judge.claim(LEASE_MS)).toBeNull();
  });

  it('refuses a worker whose row was claimed by another one', async () => {
    const id = await submit();
    const stale = await claimed(judge);
    await expireLease(id);
    const current = await claimed(judge);
    expect(await judge.giveUp(stale, 'sandbox-error', LEASE_MS)).toBe('lost');
    expect(await row(id)).toMatchObject({ status: 'judging', claimToken: current.token });
  });
});

describe('CheckQueue', () => {
  it('is empty until a submission is Accepted', async () => {
    await submit();
    expect(await check.claim(LEASE_MS)).toBeNull();
  });

  it('claims a job once and again when its lease ran out, and leaves the judge row alone', async () => {
    const id = await accepted();
    const before = await row(id);
    const first = await claimed(check);
    expect(first).toMatchObject({ submissionId: id, attempts: 1 });
    expect(await check.claim(LEASE_MS)).toBeNull();
    await expireCheckLease(id);
    expect((await claimed(check)).token).not.toBe(first.token);
    expect(await row(id)).toEqual(before);
  });

  it('stores the proposals and finishes the job', async () => {
    const id = await accepted();
    expect(await check.complete(await claimed(check), [PROPOSAL])).toBe(true);
    expect(await job(id)).toMatchObject({ status: 'done', claimToken: null, leaseUntil: null });
    expect(await database.db.select().from(reviewProposals)).toMatchObject([
      { submissionId: id, constraintId: CONSTRAINT, verdict: 'violation', decision: null },
    ]);
    expect(await check.claim(LEASE_MS)).toBeNull();
  });

  it('stores one set of verdicts when the checking ran twice', async () => {
    const id = await accepted();
    const stale = await claimed(check);
    await expireCheckLease(id);
    const current = await claimed(check);
    const other: ReviewProposal = { ...PROPOSAL, verdict: 'pass', evidence: [] };
    expect(await check.complete(stale, [other])).toBe(false);
    expect(await check.complete(current, [PROPOSAL])).toBe(true);
    expect(await database.db.select().from(reviewProposals)).toMatchObject([
      { verdict: 'violation' },
    ]);
  });

  it('keeps the job claimable when the proposals are refused', async () => {
    const id = await accepted();
    const claim = await claimed(check);
    const refused: ReviewProposal = { ...PROPOSAL, evidence: [{ line: 1, text: 'made up' }] };
    await expect(check.complete(claim, [refused])).rejects.toThrow('Invalid proposal evidence.');
    expect(await job(id)).toMatchObject({ status: 'checking', claimToken: claim.token });
    expect(await check.giveUp(claim, 'check-error', LEASE_MS)).toBe('retry');
  });

  it('fails the job after 3 claims; the judge result stays', async () => {
    const id = await accepted();
    for (let i = 0; i < 3; i++) {
      await claimed(check);
      await expireCheckLease(id);
    }
    expect(await check.claim(LEASE_MS)).toBeNull();
    expect(await job(id)).toMatchObject({ status: 'failed', failureCause: 'worker-lost' });
    expect(await row(id)).toMatchObject({ status: 'judged' });
  });
});
