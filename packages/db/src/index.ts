export { createDb, requireDatabaseUrl } from './client.js';
export type { DbHandle } from './client.js';
export { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';
export { SEED, seed } from './seed.js';
export { DrizzleSubmissionData } from './submission-data.js';
export type {
  Database,
  IdempotencyScope,
  InsertResult,
  InsertSubmission,
  StoredSubmission,
  StudentLab,
  SubmissionReceipt,
} from './submission-data.js';
export * as schema from './schema.js';
