import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { PostgresClassrooms } from '../src/classes/postgres-classrooms.js';

let database: TestDatabase;
let classrooms: PostgresClassrooms;

beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
  classrooms = new PostgresClassrooms(database.db);
});

afterAll(async () => {
  await database?.drop();
});

describe('classrooms in PostgreSQL', () => {
  it('lists only classes the student or TA belongs to', async () => {
    for (const principal of [
      { id: SEED.users.student, role: 'student' as const },
      { id: SEED.users.ta, role: 'ta' as const },
    ]) {
      expect((await classrooms.listClasses(principal)).map((row) => row.id)).toEqual([
        SEED.classes.sorting,
      ]);
    }
  });

  it('lets an administrator list all classes and create another', async () => {
    const created = await classrooms.createClass('NEW-CLASS', 'New class');
    const classes = await classrooms.listClasses({ id: SEED.users.admin, role: 'admin' });
    expect(classes).toContainEqual(created);
    expect(classes.map((row) => row.id)).toEqual(
      expect.arrayContaining([SEED.classes.sorting, SEED.classes.other]),
    );
  });
});
