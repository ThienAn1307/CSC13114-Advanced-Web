import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { createDb, requireDatabaseUrl } from '../src/client.js';
import type { DbHandle } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';

export interface TestDatabase extends DbHandle {
  drop(): Promise<void>;
}

/**
 * CI sets DATABASE_URL; locally it comes from the repo's .env (README, Checks).
 * A value already in the environment wins, and nothing but DATABASE_URL is taken from the file.
 */
function databaseUrlForTests(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = new URL('../../../.env', import.meta.url);
  if (!existsSync(file)) return undefined;
  return parseEnv(readFileSync(file, 'utf8')).DATABASE_URL;
}

/**
 * A fresh database per test file, created next to DATABASE_URL's and migrated from zero.
 * No DATABASE_URL means the file fails; it never skips (README, Checks).
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = requireDatabaseUrl({ DATABASE_URL: databaseUrlForTests() });
  const name = `leetkob_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const handle = createDb(url.toString());
  await runMigrations(handle.db);

  return {
    ...handle,
    async drop() {
      await handle.close();
      const cleanup = new pg.Client({ connectionString: baseUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
