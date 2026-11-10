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
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** Reads DATABASE_URL and fails loudly without echoing any value. */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required (see .env.example).');
  return url;
}
