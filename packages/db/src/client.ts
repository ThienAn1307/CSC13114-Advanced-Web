import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import type { Database } from './submission-data.js';

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** The composition root owns the pool's lifecycle and calls close() on shutdown. */
export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // An idle client that loses its connection emits 'error' on the pool; without a listener that
  // crashes the process. Log a fixed message only: the error may contain the connection string.
  pool.on('error', () => {
    console.error('PostgreSQL: an idle pool connection failed and was removed from the pool.');
  });
  const db = drizzle(pool, { schema });
  // Safe to call more than once: Nest's shutdown hook and a test teardown may both close it.
  let closing: Promise<void> | undefined;
  return { db, pool, close: () => (closing ??= pool.end()) };
}

/** Reads DATABASE_URL and fails loudly without echoing any value. */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required (see .env.example).');
  return url;
}
