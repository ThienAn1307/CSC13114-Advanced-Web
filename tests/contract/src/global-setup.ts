import { databaseUrl, migrateDatabase } from './hooks.js';

/** Runs once before the contract tests. No DATABASE_URL means the run fails here, never skips. */
export default async function setup(): Promise<void> {
  databaseUrl();
  await migrateDatabase();
}
