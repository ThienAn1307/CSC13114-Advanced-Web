/**
 * The only file that knows how the API and the test database are built.
 *
 * Wiring (PR #5, #6, #7):
 * - the app is Hoàng Hải's `createApp({ config, data, queue })` from apps/api, already initialised
 *   and not listening; the tests drive `app.getHttpServer()` with supertest;
 * - `data` is the real PostgreSQL implementation, `PostgresSubmissionData`, over Phú Dinh's
 *   `createDb`, exactly as apps/api/src/server.ts composes it;
 * - `queue` is a recording fake, so the tests can see what was enqueued and make it fail (4.7);
 * - "now" is Vitest's fake `Date` (only `Date` is faked: pg, supertest and timeouts keep real
 *   timers). The app stamps `receivedAt` with `new Date()` and the JWT `exp` check reads
 *   `Date.now()`, so both follow the test clock.
 */
import type { Server } from 'node:http';
import { vi } from 'vitest';
import { createDb, runMigrations, schema, seed, SEED as DB_SEED } from '@leetkob/db';
import type { DbHandle } from '@leetkob/db';
import { createApp } from '@leetkob/api/src/app.js';
import { PostgresSubmissionData } from '@leetkob/api/src/postgres-submission-data.js';
import type { SubmissionQueue } from '@leetkob/api/src/submissions/submission-data.js';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** The tests' names for Phú Dinh's seed ids (packages/db/src/seed.ts). */
export interface SeedIds {
  users: { stu1: string; stu2: string; stu3: string; ta_a: string; admin: string };
  labs: { class1Open: string; class1NotOpen: string; class1Closed: string; class2Open: string };
}

const SEED_IDS: SeedIds = {
  users: {
    stu1: DB_SEED.users.student,
    stu2: DB_SEED.users.classmate,
    stu3: DB_SEED.users.otherStudent,
    ta_a: DB_SEED.users.ta,
    admin: DB_SEED.users.admin,
  },
  labs: {
    class1Open: DB_SEED.labs.open,
    class1NotOpen: DB_SEED.labs.notOpen,
    class1Closed: DB_SEED.labs.closed,
    class2Open: DB_SEED.labs.otherClass,
  },
};

/**
 * The seed's windows, relative to the `now` passed to `seed`: open labs (class 1 and class 2)
 * opened 1 day before `now` and close 7 days after it; the not-open lab opens 1 day after `now`;
 * the closed lab closed 1 day before `now`. The open lab stays open for more than 24 hours,
 * which the key-expiry tests need.
 */
export const SEED_WINDOWS = {
  openLabOpenedBeforeMs: DAY_MS,
  openLabDueAfterMs: 7 * DAY_MS,
} as const;

/** Test-only signing secret, set by vitest.config.ts; never read from .env. */
function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set by tests/contract/vitest.config.ts');
  return secret;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The contract tests need PostgreSQL 16; they fail, never skip (README, Checks).',
    );
  }
  return url;
}

export async function migrateDatabase(): Promise<void> {
  const handle = createDb(databaseUrl());
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}

/** Empties what earlier tests wrote, then writes the seed around `now`. */
async function resetAndSeed(handle: DbHandle, now: Date): Promise<void> {
  await handle.db.delete(schema.idempotencyKeys);
  await handle.db.delete(schema.submissions);
  await seed(handle.db, now);
}

/** "Now" as the server sees it: Vitest's fake `Date`, which stands still until a test moves it. */
export class TestClock {
  now(): Date {
    return new Date();
  }

  set(at: Date): void {
    vi.setSystemTime(at);
  }

  advance(ms: number): void {
    vi.setSystemTime(Date.now() + ms);
  }
}

/** A fake queue that records every enqueue, and can be told to fail (contract section 4.7). */
export class RecordingQueue implements SubmissionQueue {
  readonly calls: string[] = [];
  failure: Error | undefined;

  enqueue(submissionId: string): Promise<void> {
    this.calls.push(submissionId);
    return this.failure ? Promise.reject(this.failure) : Promise.resolve();
  }
}

export interface Harness {
  server: Server;
  seed: SeedIds;
  /** The `now` the seed was built around, and where the clock starts. */
  seededAt: Date;
  clock: TestClock;
  queue: RecordingQueue;
  close(): Promise<void>;
}

/** A freshly seeded database and a new app around the test clock and a recording queue. */
export async function startHarness(): Promise<Harness> {
  const seededAt = new Date();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(seededAt);
  const handle = createDb(databaseUrl());
  try {
    await resetAndSeed(handle, seededAt);
    const queue = new RecordingQueue();
    const app = await createApp({
      config: { jwtSecret: jwtSecret(), port: 0 },
      data: new PostgresSubmissionData(handle),
      queue,
    });
    return {
      server: app.getHttpServer(),
      seed: SEED_IDS,
      seededAt,
      clock: new TestClock(),
      queue,
      close: async () => {
        try {
          await app.close();
          await handle.close();
        } finally {
          vi.useRealTimers();
        }
      },
    };
  } catch (error) {
    await handle.close();
    vi.useRealTimers();
    throw error;
  }
}
