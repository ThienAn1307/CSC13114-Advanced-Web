import { createDb, requireDatabaseUrl } from './client.js';
import { seed } from './seed.js';

const handle = createDb(requireDatabaseUrl());
try {
  await seed(handle.db, new Date());
  console.log('Seed data written.');
} finally {
  await handle.close();
}
