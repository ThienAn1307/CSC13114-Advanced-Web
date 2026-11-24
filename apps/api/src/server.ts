// The composition root (docs/member-x-handoff.md, "Connecting Y's implementation"):
// real PostgreSQL data, the outbox-only queue, then X's bootstrap.
import { createDb, requireDatabaseUrl } from '../../../packages/db/src/client.js';
import { validateConfig } from './config.js';
import { bootstrap } from './main.js';
import { outboxOnlyQueue } from './outbox-queue.js';
import { PostgresSubmissionData } from './postgres-submission-data.js';
import { PostgresAccounts } from './auth/postgres-accounts.js';
import { PostgresClassrooms } from './classes/postgres-classrooms.js';
import { PostgresMembers } from './classes/postgres-members.js';
import { PostgresLabs } from './classes/postgres-labs.js';
import { PostgresStudentSubmissions } from './submissions/postgres-student-submissions.js';

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
  await bootstrap(new PostgresSubmissionData(handle), outboxOnlyQueue, {
    accounts: new PostgresAccounts(handle.db),
    classrooms: new PostgresClassrooms(handle.db),
    members: new PostgresMembers(handle.db),
    labs: new PostgresLabs(handle.db),
    studentSubmissions: new PostgresStudentSubmissions(handle.db),
  });
} catch (error) {
  await handle.close();
  throw error;
}
console.log(`LeeTKOB API listening on port ${validateConfig(process.env).port}`);
