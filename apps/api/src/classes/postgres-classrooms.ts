import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../../../../packages/db/src/submission-data.js';
import { classMembers, classes } from '../../../../packages/db/src/schema.js';
import type { Principal } from '../common/request.js';
import type { Classroom, Classrooms } from './classrooms.js';

export class PostgresClassrooms implements Classrooms {
  constructor(private readonly db: Database) {}
  async createClass(code: string, name: string): Promise<Classroom> {
    const classroom = { id: randomUUID(), code, name };
    await this.db.insert(classes).values(classroom);
    return classroom;
  }
  async listClasses(principal: Principal): Promise<Classroom[]> {
    if (principal.role === 'admin') return this.db.select().from(classes);
    // Theo FAQ-01: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-01
    return this.db
      .select({ id: classes.id, code: classes.code, name: classes.name })
      .from(classes)
      .innerJoin(classMembers, eq(classes.id, classMembers.classId))
      .where(eq(classMembers.userId, principal.id));
  }
}
