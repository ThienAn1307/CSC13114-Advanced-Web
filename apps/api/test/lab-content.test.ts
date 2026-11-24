import { afterAll, beforeAll, expect, it } from 'vitest';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { PostgresLabs } from '../src/classes/postgres-labs.js';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
});
afterAll(async () => {
  await database?.drop();
});

it('shows open-lab constraints to members without leaking hidden test data', async () => {
  const store = new PostgresLabs(database.db);
  const ta = { id: SEED.users.ta, role: 'ta' as const };
  const student = { id: SEED.users.student, role: 'student' as const };
  const now = Date.now();
  const created = await store.create(ta, SEED.classes.sorting, {
    title: 'Configured lab',
    statement: 'Problem statement',
    opensAt: new Date(now - 1000),
    deadlineAt: new Date(now + 60000),
    cpuLimitSeconds: 2,
    memoryLimitMb: 256,
    constraints: [{ text: 'Use a loop', deduction: 1.25 }],
    testCases: [{ input: 'private input', expectedOutput: 'private output' }],
  });
  const studentLab = (await store.list(student, SEED.classes.sorting))?.find(
    (lab) => lab.id === created?.id,
  );
  expect(studentLab).toMatchObject({
    statement: 'Problem statement',
    constraints: [{ text: 'Use a loop', deduction: 1.25 }],
  });
  expect(JSON.stringify(studentLab)).not.toContain('private input');
  expect(JSON.stringify(studentLab)).not.toContain('private output');
  const taLab = (await store.list(ta, SEED.classes.sorting))?.find((lab) => lab.id === created?.id);
  expect(taLab?.testCases).toEqual([{ input: 'private input', expectedOutput: 'private output' }]);
});

it('does not reveal statement or constraints to students before opening', async () => {
  const store = new PostgresLabs(database.db);
  const ta = { id: SEED.users.ta, role: 'ta' as const };
  const student = { id: SEED.users.student, role: 'student' as const };
  const now = Date.now();
  const created = await store.create(ta, SEED.classes.sorting, {
    title: 'Future lab',
    statement: 'Not open yet',
    opensAt: new Date(now + 60000),
    deadlineAt: new Date(now + 120000),
    constraints: [{ text: 'Future constraint', deduction: 1 }],
    testCases: [{ input: '', expectedOutput: '' }],
  });
  const studentLab = (await store.list(student, SEED.classes.sorting))?.find(
    (lab) => lab.id === created?.id,
  );
  expect(studentLab).not.toHaveProperty('statement');
  expect(studentLab).not.toHaveProperty('constraints');
  expect(studentLab).not.toHaveProperty('testCases');
});
