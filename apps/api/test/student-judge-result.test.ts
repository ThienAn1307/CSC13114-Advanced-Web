import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { judgeResults, submissions } from '../../../packages/db/src/schema.js';
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

it('shows the student the judge result but no constraint-review information', async () => {
  const id = randomUUID();
  await database.db.insert(submissions).values({
    id,
    labId: SEED.labs.open,
    studentId: SEED.users.student,
    source: 'source',
    sizeBytes: 6,
    receivedAt: new Date(),
    status: 'queued',
  });
  await database.db
    .insert(judgeResults)
    .values({ submissionId: id, status: 'AC', finishedAt: new Date() });
  const rows = await new PostgresStudentSubmissions(database.db).list(SEED.users.student);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id, status: 'AC' });
  expect(Object.keys(rows[0]!).sort()).toEqual([
    'id',
    'labId',
    'receivedAt',
    'sizeBytes',
    'status',
  ]);
});
