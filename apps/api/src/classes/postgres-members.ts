import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../../../packages/db/src/submission-data.js';
import { classMembers, classes, users } from '../../../../packages/db/src/schema.js';
import type { Principal } from '../common/request.js';
import type { AddMemberResult, Members, NewMember } from './members.js';

export class PostgresMembers implements Members {
  constructor(private readonly db: Database) {}

  async add(principal: Principal, classId: string, member: NewMember): Promise<AddMemberResult> {
    return this.db.transaction(async (tx) => {
      if (
        (member.role === 'ta' && principal.role !== 'admin') ||
        (member.role === 'student' && principal.role !== 'ta')
      )
        return 'unavailable';
      const matchingClass = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(eq(classes.id, classId))
        .limit(1);
      if (!matchingClass.length) return 'unavailable';
      if (principal.role === 'ta') {
        const membership = await tx
          .select({ userId: classMembers.userId })
          .from(classMembers)
          .where(and(eq(classMembers.classId, classId), eq(classMembers.userId, principal.id)))
          .limit(1);
        if (!membership.length) return 'unavailable';
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${member.email}))`);
      const matches = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(sql`lower(${users.email}) = ${member.email}`)
        .limit(2);
      if (matches.length > 1 || (matches[0] && matches[0].role !== member.role))
        return 'invalid-account';
      let userId = matches[0]?.id;
      if (!userId) {
        if (!member.passwordHash) return 'invalid-account';
        userId = randomUUID();
        await tx.insert(users).values({
          id: userId,
          email: member.email,
          displayName: member.displayName,
          role: member.role,
          passwordHash: member.passwordHash,
        });
      }
      await tx.insert(classMembers).values({ classId, userId }).onConflictDoNothing();
      return 'added';
    });
  }
}
