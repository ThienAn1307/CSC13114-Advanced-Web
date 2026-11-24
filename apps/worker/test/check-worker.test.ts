import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model, ModelResponse } from '../../../packages/checker/src/model.ts';
import { CheckQueue, JudgeQueue } from '../../../packages/db/src/job-queue.js';
import { ModelCallLog } from '../../../packages/db/src/model-calls.js';
import { PostgresReviewQueue } from '../../../packages/db/src/review-queue.js';
import {
  checkJobs,
  judgeResults,
  judgeTestResults,
  labConstraints,
  labs,
  modelCalls,
  reviewProposals,
  submissions,
  users,
} from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { checkNext } from '../src/check-worker.js';
import type { CheckWorkerOptions } from '../src/check-worker.js';

// decisions.md D8, D12, D14, D15, D18. The model is always a fake.
const BAN = randomUUID();
const SEMANTIC = randomUUID();
const SOURCE = [
  '// Nguyen Van A, 23120999',
  '#include <algorithm>',
  'int main() { int a[2]; std::sort(a, a + 2); } // by Nguyen Van A',
].join('\n');

let database: TestDatabase;
let judge: JudgeQueue;
let queue: CheckQueue;

beforeAll(async () => {
  database = await createTestDatabase();
  judge = new JudgeQueue(database.db);
  queue = new CheckQueue(database.db);
  await seed(database.db, new Date());
  await database.db
    .update(users)
    .set({ displayName: 'Nguyen Van A', email: '23120999@student.leetkob.test' })
    .where(eq(users.id, SEED.users.student));
  await database.db
    .update(labs)
    .set({ statement: 'Sort two numbers.' })
    .where(eq(labs.id, SEED.labs.open));
  await database.db.insert(labConstraints).values([
    {
      id: SEMANTIC,
      labId: SEED.labs.open,
      text: 'Sort with your own merge sort.',
      deductionHundredths: 400,
      position: 2,
    },
    {
      id: BAN,
      labId: SEED.labs.open,
      text: 'Do not call `std::sort`.',
      deductionHundredths: 300,
      position: 1,
    },
  ]);
});

afterAll(async () => {
  await database?.drop();
});

beforeEach(async () => {
  for (const table of [
    modelCalls,
    reviewProposals,
    checkJobs,
    judgeTestResults,
    judgeResults,
    submissions,
  ]) {
    await database.db.delete(table);
  }
});

const ANSWER: ModelResponse = {
  text: JSON.stringify({ verdict: 'pass', evidence: [], reason: 'fine' }),
  requestId: 'req-1',
  model: 'fake-model-001',
  tokensIn: 700,
  tokensOut: 100,
  costNanoUsd: 325_000,
};

function fakeModel(complete: Model['complete'] = () => Promise.resolve(ANSWER)) {
  return { name: 'fake-model', complete: vi.fn<Model['complete']>(complete) };
}

function worker(
  model: Model | null,
  overrides: Partial<CheckWorkerOptions> = {},
): CheckWorkerOptions {
  return {
    queue,
    calls: new ModelCallLog(database.db),
    model,
    timeoutMs: 5000,
    maxCallsPerLab: 100,
    leaseMs: 60_000,
    heartbeatMs: 20_000,
    retryMs: 30_000,
    log: () => {},
    ...overrides,
  };
}

async function accepted(source = SOURCE): Promise<string> {
  const id = randomUUID();
  await database.db.insert(submissions).values({
    id,
    labId: SEED.labs.open,
    studentId: SEED.users.student,
    source,
    sizeBytes: source.length,
    receivedAt: new Date(),
  });
  const claim = await judge.claim(60_000);
  await judge.complete(claim!, { status: 'AC', tests: ['AC'] });
  return id;
}

async function proposals() {
  const rows = await database.db.select().from(reviewProposals);
  return new Map(rows.map((row) => [row.constraintId, row]));
}

async function job(id: string) {
  const [row] = await database.db.select().from(checkJobs).where(eq(checkJobs.submissionId, id));
  return row!;
}

async function expireLease(id: string) {
  await database.db
    .update(checkJobs)
    .set({ leaseUntil: sql`now() - interval '1 second'` })
    .where(eq(checkJobs.submissionId, id));
}

describe('checkNext', () => {
  it('is idle when no Accepted submission waits', async () => {
    expect(await checkNext(worker(fakeModel()))).toBe('idle');
  });

  it('puts one proposal per constraint in the TA queue and decides nothing', async () => {
    const id = await accepted();
    expect(await checkNext(worker(fakeModel()))).toBe('checked');
    expect((await job(id)).status).toBe('done');
    const stored = await proposals();
    expect(stored.size).toBe(2);
    expect(stored.get(BAN)).toMatchObject({
      verdict: 'violation',
      decidedBy: 'hard-rule',
      decision: null,
    });
    expect(stored.get(BAN)!.evidence).toMatchObject([{ line: 3 }]);
    expect(stored.get(SEMANTIC)).toMatchObject({
      verdict: 'pass',
      decidedBy: 'model',
      decision: null,
    });
    const ta = { id: SEED.users.ta, role: 'ta' as const };
    const listed = await new PostgresReviewQueue(database.db).list(ta, SEED.classes.sorting);
    expect(listed).toHaveLength(2);
  });

  it('calls the model only for the constraint no hard rule decided, without identity', async () => {
    await accepted();
    const model = fakeModel();
    await checkNext(worker(model));
    expect(model.complete).toHaveBeenCalledTimes(1);
    const { prompt } = model.complete.mock.calls[0]![0];
    expect(prompt).toContain('Sort two numbers.');
    expect(prompt).toContain('Sort with your own merge sort.');
    for (const secret of ['Nguyen Van A', '23120999', 'Do not call']) {
      expect(prompt).not.toContain(secret);
    }
  });

  it('replaces the student id, read from the email, inside a string too', async () => {
    await accepted('int main() { const char* me = "23120999"; }');
    const model = fakeModel();
    await checkNext(worker(model));
    const { prompt } = model.complete.mock.calls[0]![0];
    expect(prompt).toContain('<STUDENT_ID>');
    expect(prompt).not.toContain('23120999');
  });

  it('logs the call with its prompt, request id, tokens, time and cost', async () => {
    const id = await accepted();
    const model = fakeModel();
    await checkNext(worker(model));
    const rows = await database.db.select().from(modelCalls);
    expect(rows).toMatchObject([
      {
        submissionId: id,
        constraintId: SEMANTIC,
        labId: SEED.labs.open,
        attempt: 1,
        prompt: model.complete.mock.calls[0]![0].prompt,
        model: 'fake-model-001',
        requestId: 'req-1',
        tokensIn: 700,
        tokensOut: 100,
        costNanoUsd: 325_000,
        outcome: 'answered',
      },
    ]);
    expect(rows[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ['bad-schema', () => Promise.resolve({ ...ANSWER, text: 'not json' })],
    ['model-error', () => Promise.reject(new Error('Gemini HTTP 503'))],
    ['timeout', () => new Promise<ModelResponse>(() => {})],
  ])('turns %s into unsure, and logs it', async (cause, complete) => {
    await accepted();
    expect(await checkNext(worker(fakeModel(complete), { timeoutMs: 300 }))).toBe('checked');
    expect((await proposals()).get(SEMANTIC)).toMatchObject({
      verdict: 'unsure',
      unsureCause: cause,
      decidedBy: 'guardrail',
    });
    expect(await database.db.select().from(modelCalls)).toMatchObject([{ outcome: cause }]);
  });

  it('makes no call over the cap of the lab: the pair is unsure, the ban list is still decided', async () => {
    await accepted();
    await accepted();
    const model = fakeModel();
    const options = worker(model, { maxCallsPerLab: 1 });
    await checkNext(options);
    await database.db.delete(reviewProposals);
    expect(await checkNext(options)).toBe('checked');
    expect(model.complete).toHaveBeenCalledTimes(1);
    const stored = await proposals();
    expect(stored.get(BAN)).toMatchObject({ verdict: 'violation', decidedBy: 'hard-rule' });
    expect(stored.get(SEMANTIC)).toMatchObject({ verdict: 'unsure', unsureCause: 'cost-cap' });
    expect(await database.db.select().from(modelCalls)).toHaveLength(1);
  });

  it('makes no call with the model off', async () => {
    await accepted();
    expect(await checkNext(worker(null))).toBe('checked');
    expect((await proposals()).get(SEMANTIC)).toMatchObject({ unsureCause: 'model-off' });
    expect(await database.db.select().from(modelCalls)).toEqual([]);
  });

  it('stores one set of verdicts when a stopped worker comes back after another took over', async () => {
    const id = await accepted();
    let wake: ((value: ModelResponse) => void) | undefined;
    const stalled = checkNext(worker(fakeModel(() => new Promise((resolve) => (wake = resolve)))));
    await vi.waitFor(() => expect(wake).toBeDefined());
    await expireLease(id);
    expect(await checkNext(worker(fakeModel()))).toBe('checked');
    wake?.({ ...ANSWER, text: 'not json' });
    expect(await stalled).toBe('lost');
    expect((await proposals()).get(SEMANTIC)).toMatchObject({ verdict: 'pass' });
    expect((await database.db.select().from(modelCalls)).map((c) => c.attempt).sort()).toEqual([
      1, 2,
    ]);
  });

  it('keeps its lease while a check takes longer than the lease', async () => {
    await accepted();
    const slow = fakeModel(() => new Promise((resolve) => setTimeout(() => resolve(ANSWER), 1500)));
    const running = checkNext(worker(slow, { leaseMs: 500, heartbeatMs: 100 }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await queue.claim(500)).toBeNull();
    expect(await running).toBe('checked');
  });

  it('retries when the proposals cannot be stored, then fails; the judge result stays', async () => {
    const id = await accepted();
    const broken = new CheckQueue(database.db);
    vi.spyOn(broken, 'complete').mockRejectedValue(new Error(SOURCE));
    const lines: string[] = [];
    const options = worker(fakeModel(), { queue: broken, log: (line) => lines.push(line) });
    for (const step of ['retry', 'retry', 'failed']) {
      expect(await checkNext(options)).toBe(step);
      if (step === 'retry') await expireLease(id);
    }
    expect(await job(id)).toMatchObject({ status: 'failed', failureCause: 'check-error' });
    expect(lines.join('\n')).not.toContain('std::sort');
    const [row] = await database.db.select().from(submissions).where(eq(submissions.id, id));
    expect(row!.status).toBe('judged');
  });
});
