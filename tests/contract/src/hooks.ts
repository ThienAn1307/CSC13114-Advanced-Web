/**
 * The only file that knows how the API and the test database are built.
 * When Hoàng Hải's app and Phú Dinh's data code land, only this file changes.
 *
 * Proposed hooks, NOT yet confirmed by the teammates (notes/questions.md, U4b):
 * - Hoàng Hải: `createApp({ queue, clock })` exported by `@leetkob/api`. It returns a NestJS app
 *   that is initialised but not listening; the tests drive `app.getHttpServer()` with supertest.
 *   `clock` replaces "now" everywhere the contract says "the time the server receives the request".
 * - Phú Dinh: `migrate(databaseUrl)`, `resetAndSeed(databaseUrl, now)` and `SEED` (fixed ids),
 *   also exported by `@leetkob/api` (location to confirm).
 */
import type { Server } from 'node:http';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** The queue the endpoint puts a new submission on (decisions.md D6). */
export interface SubmissionQueue {
  enqueue(submissionId: string): Promise<void>;
}

/** The part of a NestJS `INestApplication` the tests use. */
interface ApiApp {
  getHttpServer(): Server;
  close(): Promise<void>;
}

/** Fixed ids from Phú Dinh's seed. The names are assumed; see notes/questions.md, U4b. */
export interface SeedIds {
  users: { stu1: string; stu2: string; stu3: string; ta_a: string; admin: string };
  labs: { class1Open: string; class1NotOpen: string; class1Closed: string; class2Open: string };
}

interface ApiModule {
  createApp(options?: { queue?: SubmissionQueue; clock?: () => Date }): Promise<ApiApp>;
  migrate(databaseUrl: string): Promise<void>;
  resetAndSeed(databaseUrl: string, now?: Date): Promise<void>;
  SEED: SeedIds;
}

/**
 * Assumed seed windows, relative to the `now` passed to `resetAndSeed`:
 * class1Open and class2Open opened 1 day before `now` and close 7 days after it;
 * class1NotOpen opens 1 day after `now`; class1Closed closed 1 day before `now`.
 * The open lab must stay open for more than 24 hours so the key-expiry test can run.
 */
export const SEED_WINDOWS = {
  openLabOpenedBeforeMs: DAY_MS,
  openLabDueAfterMs: 7 * DAY_MS,
} as const;

let apiModule: Promise<ApiModule> | undefined;

function loadApi(): Promise<ApiModule> {
  apiModule ??= import('@leetkob/api') as Promise<ApiModule>;
  return apiModule;
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
  const api = await loadApi();
  await api.migrate(databaseUrl());
}

/** "Now" as the server sees it. Tests move it to reach a deadline or a key's 24-hour expiry. */
export class TestClock {
  private current: number;

  constructor(start: Date) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date): void {
    this.current = at.getTime();
  }

  advance(ms: number): void {
    this.current += ms;
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

/** A freshly seeded database and a new app around a test clock and a recording queue. */
export async function startHarness(): Promise<Harness> {
  const api = await loadApi();
  const seededAt = new Date();
  await api.resetAndSeed(databaseUrl(), seededAt);
  const clock = new TestClock(seededAt);
  const queue = new RecordingQueue();
  const app = await api.createApp({ queue, clock: () => clock.now() });
  return {
    server: app.getHttpServer(),
    seed: api.SEED,
    seededAt,
    clock,
    queue,
    close: () => app.close(),
  };
}
