import { afterAll, beforeAll, expect, it } from 'vitest';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { PostgresLabs } from '../src/classes/postgres-labs.js';

let database: TestDatabase;
let labs: PostgresLabs;
beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
  labs = new PostgresLabs(database.db);
});
afterAll(async () => {
  await database?.drop();
});

it('only exposes and creates labs within the caller’s class', async () => {
  const ta = { id: SEED.users.ta, role: 'ta' as const };
  const student = { id: SEED.users.student, role: 'student' as const };
  const draft = {
    title: 'New lab',
    opensAt: new Date('2026-11-24T00:00:00Z'),
    deadlineAt: new Date('2026-11-25T00:00:00Z'),
  };
  expect(await labs.list(ta, SEED.classes.other)).toBeNull();
  expect(await labs.list(student, SEED.classes.other)).toBeNull();
  expect(await labs.create(ta, SEED.classes.other, draft)).toBeNull();
  expect(await labs.create(student, SEED.classes.sorting, draft)).toBeNull();
  const created = await labs.create(ta, SEED.classes.sorting, draft);
  expect(created).toMatchObject({ ...draft, classId: SEED.classes.sorting });
  expect(await labs.list(student, SEED.classes.sorting)).toContainEqual(created);
});
