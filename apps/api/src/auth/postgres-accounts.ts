import { sql } from 'drizzle-orm';
import type { Database } from '../../../../packages/db/src/submission-data.js';
import { users } from '../../../../packages/db/src/schema.js';
import type { Accounts, LoginAccount } from './accounts.js';

export class PostgresAccounts implements Accounts {
  constructor(private readonly db: Database) {}

  async findByEmail(email: string): Promise<LoginAccount | null> {
    const rows = await this.db
      .select({
        id: users.id,
        role: users.role,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(2);
    // Existing records may differ only by email case. Never pick an arbitrary account.
    return rows.length === 1 ? rows[0]! : null;
  }
}
