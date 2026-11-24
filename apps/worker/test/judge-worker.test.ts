import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JudgeQueue } from '../../../packages/db/src/job-queue.js';
import {
  checkJobs,
  judgeResults,
  judgeTestResults,
  labTestCases,
  submissions,
} from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import type { JudgeRequest, JudgeResult } from '../../../packages/judge/src/index.js';
import { judgeNext } from '../src/judge-worker.js';
import type { JudgeWorkerOptions } from '../src/judge-worker.js';

// decisions.md D11, D12. The sandbox is a fake here; packages/judge/sandbox tests the real one.
const IMAGE = `sha256:${'a'.repeat(64)}`;
const SOURCE = 'int main() {}';

let database: TestDatabase;
let queue: JudgeQueue;

beforeAll(async () => {
  database = await createTestDatabase();
  queue = new JudgeQueue(database.db);
  await seed(database.db, new Date());
  // Inserted out of order: the worker must follow `position`.
  await database.db.insert(labTestCases).values([
    { id: randomUUID(), labId: SEED.labs.open, input: 'b', expectedOutput: 'B', position: 2 },
    { id: randomUUID(), labId: SEED.labs.open, input: 'a', expectedOutput: 'A', position: 1 },
  ]);
});

afterAll(async () => {
  await database?.drop();
});

beforeEach(async () => {
  await database.db.delete(checkJobs);
  await database.db.delete(judgeTestResults);
  await database.db.delete(judgeResults);
  await database.db.delete(submissions);
});

const result = (...statuses: JudgeResult['status'][]): JudgeResult => ({
  status: statuses.find((s) => s !== 'AC') ?? 'AC',
  tests: statuses.map((status) => ({ status, wallTimedOut: false, outputExceeded: false })),
});

function worker(
  judge: (request: JudgeRequest) => Promise<JudgeResult>,
  overrides: Partial<JudgeWorkerOptions> = {},
): JudgeWorkerOptions {
  return {
    queue,
    judge,
    image: IMAGE,
    leaseMs: 60_000,
    heartbeatMs: 20_000,
    retryMs: 30_000,
    log: () => {},
    ...overrides,
  };
}

async function submit(labId: string = SEED.labs.open): Promise<string> {
  const id = randomUUID();
  await database.db.insert(submissions).values({
    id,
    labId,
    studentId: SEED.users.student,
    source: SOURCE,
    sizeBytes: SOURCE.length,
    receivedAt: new Date(),
  });
  return id;
}

async function status(id: string) {
  const [row] = await database.db.select().from(submissions).where(eq(submissions.id, id));
  return { status: row!.status, cause: row!.failureCause };
}

async function expireLease(id: string) {
  await database.db
    .update(submissions)
    .set({ leaseUntil: sql`now() - interval '1 second'` })
    .where(eq(submissions.id, id));
}

describe('judgeNext', () => {
  it('is idle when no submission waits', async () => {
    const judge = vi.fn();
    expect(await judgeNext(worker(judge))).toBe('idle');
    expect(judge).not.toHaveBeenCalled();
  });

  it('judges the source against the lab tests, in order, with the lab limits', async () => {
    await submit();
    const judge = vi.fn<JudgeWorkerOptions['judge']>(() => Promise.resolve(result('AC', 'AC')));
    expect(await judgeNext(worker(judge))).toBe('judged');
    expect(judge.mock.calls).toEqual([
      [
        {
          image: IMAGE,
          source: SOURCE,
          cases: [
            { input: 'a', expectedOutput: 'A' },
            { input: 'b', expectedOutput: 'B' },
          ],
          cpuSeconds: 1,
          memoryMb: 256,
        },
      ],
    ]);
  });

  it('stores an Accepted result, its tests and one check job', async () => {
    const id = await submit();
    await judgeNext(worker(() => Promise.resolve(result('AC', 'AC'))));
    expect(await status(id)).toEqual({ status: 'judged', cause: null });
    expect(await database.db.select().from(judgeResults)).toMatchObject([
      { submissionId: id, status: 'AC' },
    ]);
    expect(await database.db.select().from(judgeTestResults)).toHaveLength(2);
    expect(await database.db.select().from(checkJobs)).toMatchObject([{ submissionId: id }]);
  });

  it('stores a compile error with no tests and no check job', async () => {
    await submit();
    await judgeNext(worker(() => Promise.resolve({ status: 'CE', tests: [] })));
    expect(await database.db.select().from(judgeResults)).toMatchObject([{ status: 'CE' }]);
    expect(await database.db.select().from(judgeTestResults)).toEqual([]);
    expect(await database.db.select().from(checkJobs)).toEqual([]);
  });

  it('judges a submission made while no worker ran exactly once after one starts', async () => {
    const id = await submit();
    expect((await status(id)).status).toBe('queued');
    const judge = vi.fn(() => Promise.resolve(result('AC', 'AC')));
    expect(await judgeNext(worker(judge))).toBe('judged');
    expect(await judgeNext(worker(judge))).toBe('idle');
    expect(judge).toHaveBeenCalledTimes(1);
    expect(await database.db.select().from(judgeResults)).toHaveLength(1);
  });

  it('stores one result when a worker stops mid-judging and comes back after another took over', async () => {
    const id = await submit();
    let wake: ((value: JudgeResult) => void) | undefined;
    const stalled = judgeNext(worker(() => new Promise((resolve) => (wake = resolve))));
    await vi.waitFor(() => expect(wake).toBeDefined());
    await expireLease(id);
    expect(await judgeNext(worker(() => Promise.resolve(result('AC', 'AC'))))).toBe('judged');
    wake?.(result('WA', 'WA'));
    expect(await stalled).toBe('lost');
    expect(await database.db.select().from(judgeResults)).toMatchObject([{ status: 'AC' }]);
    expect(await database.db.select().from(checkJobs)).toHaveLength(1);
  });

  it('keeps its lease while a judging takes longer than the lease', async () => {
    await submit();
    const slow = judgeNext(
      worker(() => new Promise((resolve) => setTimeout(() => resolve(result('AC', 'AC')), 1500)), {
        leaseMs: 500,
        heartbeatMs: 100,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await queue.claim(500)).toBeNull();
    expect(await slow).toBe('judged');
  });

  it('retries after a sandbox error, then fails the submission on the third try', async () => {
    const id = await submit();
    const broken = worker(() => Promise.reject(new Error('docker is down')));
    expect(await judgeNext(broken)).toBe('retry');
    expect(await judgeNext(broken)).toBe('idle');
    await expireLease(id);
    expect(await judgeNext(broken)).toBe('retry');
    await expireLease(id);
    expect(await judgeNext(broken)).toBe('failed');
    expect(await status(id)).toEqual({ status: 'failed', cause: 'sandbox-error' });
    expect(await database.db.select().from(judgeResults)).toEqual([]);
  });

  it('never runs a submission of a lab with no tests as Accepted', async () => {
    const id = await submit(SEED.labs.closed);
    const judge = vi.fn();
    expect(await judgeNext(worker(judge))).toBe('retry');
    expect(judge).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      await expireLease(id);
      await judgeNext(worker(judge));
    }
    expect(await status(id)).toEqual({ status: 'failed', cause: 'lab-has-no-tests' });
  });

  it('logs neither the source nor the error text, which may quote it', async () => {
    await submit();
    const lines: string[] = [];
    await judgeNext(
      worker(() => Promise.reject(new Error(`bad ${SOURCE}`)), { log: (line) => lines.push(line) }),
    );
    expect(lines.join('\n')).toContain('sandbox-error');
    expect(lines.join('\n')).not.toContain(SOURCE);
  });
});
