// The composition root (docs/member-x-handoff.md, "Connecting Y's implementation"):
// real PostgreSQL data, the outbox-only queue, then X's bootstrap.
import { createDb, requireDatabaseUrl } from '../../../packages/db/src/client.js';
import { validateConfig } from './config.js';
import { bootstrap } from './main.js';
import { outboxOnlyQueue } from './outbox-queue.js';
import { PostgresSubmissionData } from './postgres-submission-data.js';

const handle = createDb(requireDatabaseUrl());
// Fail at startup, not on the first request, when the database cannot be reached.
// The message is fixed: the driver's error may contain the connection string.
try {
  await handle.pool.query('SELECT 1');
} catch {
  console.error('LeeTKOB API: cannot reach the database in DATABASE_URL; not starting.');
  await handle.close();
  process.exit(1);
}
try {
  await bootstrap(new PostgresSubmissionData(handle), outboxOnlyQueue);
} catch (error) {
  await handle.close();
  throw error;
}
console.log(`LeeTKOB API listening on port ${validateConfig(process.env).port}`);
