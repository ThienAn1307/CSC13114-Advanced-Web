// The composition root (docs/member-x-handoff.md, "Connecting Y's implementation"):
// real PostgreSQL data, the outbox-only queue, then X's bootstrap.
import { createDb, requireDatabaseUrl } from '../../../packages/db/src/client.js';
import { bootstrap } from './main.js';
import { outboxOnlyQueue } from './outbox-queue.js';
import { PostgresSubmissionData } from './postgres-submission-data.js';

const handle = createDb(requireDatabaseUrl());
try {
  await bootstrap(new PostgresSubmissionData(handle), outboxOnlyQueue);
} catch (error) {
  await handle.close();
  throw error;
}
console.log(`LeeTKOB API listening on port ${process.env.PORT ?? 3000}`);
