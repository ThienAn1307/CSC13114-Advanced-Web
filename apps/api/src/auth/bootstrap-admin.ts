import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../../../../packages/db/src/submission-data.js';
import { users } from '../../../../packages/db/src/schema.js';
import { hashPassword } from './password.js';

/** Create or activate the first admin; concurrent attempts are serialized in PostgreSQL. */
export async function bootstrapAdmin(
  db: Database,
  emailInput: string,
  displayNameInput: string,
  password: string,
): Promise<boolean> {
  const email = emailInput.trim().toLowerCase();
  const displayName = displayNameInput.trim();
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !displayName ||
    displayName.length > 200 ||
    password.length < 12 ||
    password.length > 1024
  ) {
    throw new Error('A valid email, display name and password of 12–1024 characters are required.');
  }
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('leetkob-bootstrap-admin'))`);
    const existingAdmin = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), isNotNull(users.passwordHash)))
      .limit(1);
    if (existingAdmin.length) return false;
    const matches = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(2);
    if (matches.length > 1 || (matches[0] && matches[0].role !== 'admin')) return false;
    if (matches[0]) {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, matches[0].id));
    } else {
      await tx
        .insert(users)
        .values({ id: randomUUID(), email, displayName, role: 'admin', passwordHash });
    }
    return true;
  });
}
