import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, requireDatabaseUrl } from '../src/client.js';
import type { DbHandle } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';

export interface TestDatabase extends DbHandle {
  drop(): Promise<void>;
}

/**
 * A fresh database per test file, created next to DATABASE_URL's and migrated from zero.
 * No DATABASE_URL means the file fails; it never skips (README, Checks).
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = requireDatabaseUrl();
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
