import { and, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { users } from '../../../packages/db/src/schema.js';
import { SEED, seed } from '../../../packages/db/src/seed.js';
import { createTestDatabase } from '../../../packages/db/test/test-database.js';
import type { TestDatabase } from '../../../packages/db/test/test-database.js';
import { bootstrapAdmin } from '../src/auth/bootstrap-admin.js';
import { verifyPassword } from '../src/auth/password.js';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db, new Date());
});
afterAll(async () => {
  await database?.drop();
});

it('activates the initial admin only once and never stores plaintext', async () => {
  expect(
    await bootstrapAdmin(database.db, 'admin@leetkob.test', 'Admin', 'example passphrase'),
  ).toBe(true);
  const [admin] = await database.db.select().from(users).where(eq(users.id, SEED.users.admin));
  expect(admin?.passwordHash).toBeTruthy();
  expect(admin?.passwordHash).not.toContain('example passphrase');
  expect(await verifyPassword('example passphrase', admin!.passwordHash!)).toBe(true);
  expect(
    await bootstrapAdmin(database.db, 'other@leetkob.test', 'Other', 'another passphrase'),
  ).toBe(false);
  const configured = await database.db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), isNotNull(users.passwordHash)));
  expect(configured).toHaveLength(1);
});
