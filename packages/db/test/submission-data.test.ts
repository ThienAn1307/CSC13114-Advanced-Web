import { createHash, randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { idempotencyKeys, submissions } from '../src/schema.js';
import { SEED, seed } from '../src/seed.js';
import { DrizzleSubmissionData } from '../src/submission-data.js';
import type { InsertSubmission } from '../src/submission-data.js';
import { createTestDatabase } from './test-database.js';
import type { TestDatabase } from './test-database.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-11T14:59:12.345Z');
const { users: U, labs: L } = SEED;

let database: TestDatabase;
let data: DrizzleSubmissionData;

beforeAll(async () => {
  database = await createTestDatabase();
  data = new DrizzleSubmissionData(database.db);
  await seed(database.db, NOW);
});

afterAll(async () => {
  await database?.drop();
});

beforeEach(async () => {
  await database.db.delete(idempotencyKeys);
  await database.db.delete(submissions);
});

function hash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

/** Builds what the API service passes in, the way it builds it (apps/api submissions.service). */
function submission(
  overrides: Partial<{
    studentId: string;
    labId: string;
    key: string;
    source: string;
    receivedAt: Date;
    requestHash: string;
  }> = {},
): InsertSubmission {
  const source = overrides.source ?? 'int main() { return 0; }\n';
  const receivedAt = overrides.receivedAt ?? NOW;
  const labId = overrides.labId ?? L.open;
  return {
    studentId: overrides.studentId ?? U.student,
    labId,
    key: overrides.key ?? 'key-1',
    source,
    requestHash: overrides.requestHash ?? hash(source),
    expiresAt: new Date(receivedAt.getTime() + DAY),
    receipt: {
      id: randomUUID(),
      labId,
      status: 'queued',
      receivedAt: receivedAt.toISOString(),
      sizeBytes: Buffer.byteLength(source, 'utf8'),
    },
  };
}

/** Waits until `n` other backends of this database are blocked on a lock. */
async function waitForBlockedBackends(client: PoolClient, n: number): Promise<void> {
  const deadline = Date.now() + 10000;
  for (;;) {
    // Inside a transaction pg_stat_activity is a snapshot taken once; clear it to see new waits.
    await client.query('select pg_stat_clear_snapshot()');
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.n ?? 0) >= n) return;
    if (Date.now() > deadline) throw new Error(`only ${rows[0]?.n ?? 0} of ${n} requests blocked`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function countRows() {
  const [s] = await database.db.select({ n: count() }).from(submissions);
  const [k] = await database.db.select({ n: count() }).from(idempotencyKeys);
  return { submissions: s?.n ?? -1, keys: k?.n ?? -1 };
}

describe('findLabForStudent', () => {
  it('returns the lab, with its window, to a member of the lab class', async () => {
    const lab = await data.findLabForStudent(U.student, L.open);
    expect(lab).toEqual({
      id: L.open,
      opensAt: new Date(NOW.getTime() - DAY),
      deadlineAt: new Date(NOW.getTime() + 7 * DAY),
    });
  });

  it('returns labs that are not open yet or closed: the window is the caller check', async () => {
    expect(await data.findLabForStudent(U.student, L.notOpen)).not.toBeNull();
    expect(await data.findLabForStudent(U.student, L.closed)).not.toBeNull();
  });

  it('returns null for a lab of a class the student is not in, as for a lab that does not exist', async () => {
    expect(await data.findLabForStudent(U.student, L.otherClass)).toBeNull();
    expect(await data.findLabForStudent(U.otherStudent, L.open)).toBeNull();
    expect(await data.findLabForStudent(U.student, randomUUID())).toBeNull();
  });

  it('returns null for an id that is not a UUID instead of raising a database error', async () => {
    await expect(data.findLabForStudent(U.student, 'not-a-uuid')).resolves.toBeNull();
    await expect(data.findLabForStudent('not-a-uuid', L.open)).resolves.toBeNull();
  });
});

describe('insertSubmission', () => {
  it('stores the submission and its key together and returns the receipt', async () => {
    const input = submission();
    const result = await data.insertSubmission(input);

    expect(result).toEqual({
      created: true,
      stored: {
        requestHash: input.requestHash,
        receipt: input.receipt,
        expiresAt: input.expiresAt,
      },
    });
    expect(await countRows()).toEqual({ submissions: 1, keys: 1 });
    const [row] = await database.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, input.receipt.id));
    expect(row).toMatchObject({
      studentId: U.student,
      labId: L.open,
      source: input.source,
      status: 'queued',
      receivedAt: NOW,
      sizeBytes: input.receipt.sizeBytes,
    });
  });

  it('keeps receivedAt to the millisecond, as the contract receipt shows it', async () => {
    const input = submission({ receivedAt: new Date('2026-11-11T14:59:59.999Z') });
    await data.insertSubmission(input);
    const stored = await data.findIdempotencyKey(input);
    expect(stored?.receipt.receivedAt).toBe('2026-11-11T14:59:59.999Z');
  });

  it('returns the live winner with created: false and writes nothing for a second insert', async () => {
    const first = submission();
    await data.insertSubmission(first);
    const second = submission({ source: 'different', receivedAt: new Date(NOW.getTime() + 1000) });

    const result = await data.insertSubmission(second);

    expect(result).toEqual({
      created: false,
      stored: {
        requestHash: first.requestHash,
        receipt: first.receipt,
        expiresAt: first.expiresAt,
      },
    });
    expect(await countRows()).toEqual({ submissions: 1, keys: 1 });
  });

  it('creates exactly one submission when many requests with one key arrive at once', async () => {
    const inputs = Array.from({ length: 8 }, (_, i) =>
      submission({ source: i % 2 === 0 ? 'same body' : `body ${i}` }),
    );

    // Force the overlap instead of hoping for it: a gate connection locks `submissions`, so every
    // request blocks inside its transaction. Only when all of them are waiting is the gate opened.
    const gate = await database.pool.connect();
    let results;
    try {
      await gate.query('begin');
      await gate.query('lock table submissions in exclusive mode');
      const pending = Promise.all(inputs.map((input) => data.insertSubmission(input)));
      await waitForBlockedBackends(gate, inputs.length);
      await gate.query('commit');
      results = await pending;
    } finally {
      gate.release();
    }

    const winners = results.filter((r) => r.created);
    expect(winners).toHaveLength(1);
    const winnerId = winners[0]?.stored.receipt.id;
    for (const r of results) expect(r.stored.receipt.id).toBe(winnerId);
    expect(await countRows()).toEqual({ submissions: 1, keys: 1 });
  });

  it('takes one lock for one scope whatever the case of the student and lab UUIDs', async () => {
    const lower = submission({ studentId: U.student, labId: L.open });
    const upper = submission({ studentId: U.student.toUpperCase(), labId: L.open.toUpperCase() });

    // Same gate as above: both requests must be inside their transactions before either inserts.
    const gate = await database.pool.connect();
    let results;
    try {
      await gate.query('begin');
      await gate.query('lock table submissions in exclusive mode');
      const pending = Promise.all([data.insertSubmission(lower), data.insertSubmission(upper)]);
      await waitForBlockedBackends(gate, 2);
      await gate.query('commit');
      results = await pending;
    } finally {
      gate.release();
    }

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0]?.stored.receipt.id).toBe(results[1]?.stored.receipt.id);
    expect(await countRows()).toEqual({ submissions: 1, keys: 1 });
  });

  it('rolls back the submission when the key row cannot be written', async () => {
    const input = submission({ requestHash: 'not-a-sha256' });
    await expect(data.insertSubmission(input)).rejects.toThrow();
    expect(await countRows()).toEqual({ submissions: 0, keys: 0 });
  });

  it('treats a key as expired when expiresAt equals the new receivedAt', async () => {
    const first = submission();
    await data.insertSubmission(first);

    const justBefore = submission({ receivedAt: new Date(NOW.getTime() + DAY - 1) });
    expect((await data.insertSubmission(justBefore)).created).toBe(false);

    const atExpiry = submission({ receivedAt: new Date(NOW.getTime() + DAY) });
    const result = await data.insertSubmission(atExpiry);

    expect(result.created).toBe(true);
    expect(await countRows()).toEqual({ submissions: 2, keys: 1 });
    const stored = await data.findIdempotencyKey(atExpiry);
    expect(stored?.receipt.id).toBe(atExpiry.receipt.id);
    expect(stored?.expiresAt).toEqual(new Date(NOW.getTime() + 2 * DAY));
  });

  it('compares keys exactly, case included', async () => {
    expect((await data.insertSubmission(submission({ key: 'Key-A' }))).created).toBe(true);
    expect((await data.insertSubmission(submission({ key: 'key-a' }))).created).toBe(true);
    expect(await countRows()).toEqual({ submissions: 2, keys: 2 });
  });

  it('scopes a key to one student and one lab', async () => {
    expect((await data.insertSubmission(submission())).created).toBe(true);
    expect((await data.insertSubmission(submission({ studentId: U.classmate }))).created).toBe(
      true,
    );
    expect((await data.insertSubmission(submission({ labId: L.closed }))).created).toBe(true);
    expect(await countRows()).toEqual({ submissions: 3, keys: 3 });
  });
});

describe('findIdempotencyKey', () => {
  it('returns null for a key never stored', async () => {
    expect(
      await data.findIdempotencyKey({ studentId: U.student, labId: L.open, key: 'nope' }),
    ).toBeNull();
  });

  it('returns the original receipt with status queued', async () => {
    const input = submission();
    await data.insertSubmission(input);
    expect(await data.findIdempotencyKey(input)).toEqual({
      requestHash: input.requestHash,
      receipt: input.receipt,
      expiresAt: input.expiresAt,
    });
  });

  it('still returns an expired key: the caller compares expiresAt with its receivedAt', async () => {
    const input = submission({ receivedAt: new Date(NOW.getTime() - 2 * DAY) });
    await data.insertSubmission(input);
    const stored = await data.findIdempotencyKey(input);
    expect(stored?.expiresAt).toEqual(new Date(NOW.getTime() - DAY));
  });

  it('does not find a key of another student or another lab', async () => {
    await data.insertSubmission(submission());
    expect(
      await data.findIdempotencyKey({ studentId: U.classmate, labId: L.open, key: 'key-1' }),
    ).toBeNull();
    expect(
      await data.findIdempotencyKey({ studentId: U.student, labId: L.closed, key: 'key-1' }),
    ).toBeNull();
  });
});

describe('listQueuedSubmissions', () => {
  it('lists queued rows received before the cutoff, by receivedAt then id, up to the limit', async () => {
    const early = submission({ key: 'a', receivedAt: new Date(NOW.getTime() - 3000) });
    const tieA = submission({ key: 'b', receivedAt: new Date(NOW.getTime() - 2000) });
    const tieB = submission({ key: 'c', receivedAt: new Date(NOW.getTime() - 2000) });
    const atCutoff = submission({ key: 'd', receivedAt: NOW });
    for (const s of [atCutoff, tieB, early, tieA]) await data.insertSubmission(s);

    // PostgreSQL orders uuid by its bytes, which is the code-unit order of lowercase hex text.
    const ties = [tieA.receipt, tieB.receipt].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(await data.listQueuedSubmissions(NOW, 10)).toEqual([early.receipt, ...ties]);
    expect(await data.listQueuedSubmissions(NOW, 2)).toEqual([early.receipt, ties[0]]);
  });
});

describe('seed', () => {
  it('can run again without failing and moves the lab windows with now', async () => {
    const later = new Date(NOW.getTime() + 3 * DAY);
    await seed(database.db, later);
    const lab = await data.findLabForStudent(U.student, L.open);
    expect(lab?.opensAt).toEqual(new Date(later.getTime() - DAY));
    await seed(database.db, NOW);
  });
});
