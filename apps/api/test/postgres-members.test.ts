import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classMembers, users } from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { PostgresMembers } from '../src/classes/postgres-members.js';

let database: TestDatabase;
let members: PostgresMembers;
beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
  members = new PostgresMembers(database.db);
});
afterAll(async () => {
  await database?.drop();
});

describe('class members', () => {
  it('lets a TA create a student in their class but not another class', async () => {
    const ta = { id: SEED.users.ta, role: 'ta' as const };
    const member = {
      email: 'new@leetkob.test',
      displayName: 'New student',
      role: 'student' as const,
      passwordHash: await hashPassword('example passphrase'),
    };
    expect(await members.add(ta, SEED.classes.other, member)).toBe('unavailable');
    expect(
      await database.db.select().from(users).where(eq(users.email, member.email)),
    ).toHaveLength(0);
    expect(await members.add(ta, SEED.classes.sorting, member)).toBe('added');
    const [student] = await database.db.select().from(users).where(eq(users.email, member.email));
    expect(await verifyPassword('example passphrase', student!.passwordHash!)).toBe(true);
    expect(
      (
        await database.db.select().from(classMembers).where(eq(classMembers.userId, student!.id))
      ).map((row) => row.classId),
    ).toEqual([SEED.classes.sorting]);
  });

  it('never lets an assignment overwrite an existing user password', async () => {
    const before = await database.db.select().from(users).where(eq(users.id, SEED.users.student));
    const result = await members.add({ id: SEED.users.ta, role: 'ta' }, SEED.classes.sorting, {
      email: 'student@leetkob.test',
      displayName: 'Ignored',
      role: 'student',
      passwordHash: await hashPassword('different passphrase'),
    });
    expect(result).toBe('added');
    const after = await database.db.select().from(users).where(eq(users.id, SEED.users.student));
    expect(after[0]?.passwordHash).toBe(before[0]?.passwordHash);
  });

  it('rejects TAs assigning TAs and users with a conflicting role', async () => {
    const ta = { id: SEED.users.ta, role: 'ta' as const };
    expect(
      await members.add(ta, SEED.classes.sorting, {
        email: 'new-ta@leetkob.test',
        displayName: 'TA',
        role: 'ta',
      }),
    ).toBe('unavailable');
    expect(
      await members.add(ta, SEED.classes.sorting, {
        email: 'admin@leetkob.test',
        displayName: 'Admin',
        role: 'student',
      }),
    ).toBe('invalid-account');
  });
});
