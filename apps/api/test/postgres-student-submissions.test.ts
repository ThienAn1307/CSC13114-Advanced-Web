import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { submissions } from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { PostgresStudentSubmissions } from '../src/submissions/postgres-student-submissions.js';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
});
afterAll(async () => {
  await database?.drop();
});

it('returns only the student’s own public submission fields', async () => {
  const one = randomUUID();
  const two = randomUUID();
  await database.db.insert(submissions).values([
    {
      id: one,
      labId: SEED.labs.open,
      studentId: SEED.users.student,
      source: 'a',
      sizeBytes: 1,
      status: 'queued',
      receivedAt: new Date(),
    },
    {
      id: two,
      labId: SEED.labs.open,
      studentId: SEED.users.classmate,
      source: 'b',
      sizeBytes: 1,
      status: 'queued',
      receivedAt: new Date(),
    },
  ]);
  const rows = await new PostgresStudentSubmissions(database.db).list(SEED.users.student);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: one, labId: SEED.labs.open, status: 'queued' });
  expect(Object.keys(rows[0]!).sort()).toEqual([
    'id',
    'labId',
    'receivedAt',
    'sizeBytes',
    'status',
  ]);
});
