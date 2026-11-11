import { createDb, requireDatabaseUrl } from './client.js';
import { runMigrations } from './migrate.js';

const handle = createDb(requireDatabaseUrl());
try {
  await runMigrations(handle.db);
  console.log('Migrations applied.');
} finally {
  await handle.close();
}
