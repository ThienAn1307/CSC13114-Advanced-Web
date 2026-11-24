import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../../../packages/db/src/submission-data.js';
import { submissions } from '../../../../packages/db/src/schema.js';
import type { StudentSubmissions, StudentSubmissionStatus } from './student-submissions.js';

export class PostgresStudentSubmissions implements StudentSubmissions {
  constructor(private readonly db: Database) {}

  async list(studentId: string): Promise<StudentSubmissionStatus[]> {
    // Theo FAQ-08: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-08
    return this.db
      .select({
        id: submissions.id,
        labId: submissions.labId,
        status: submissions.status,
        receivedAt: submissions.receivedAt,
        sizeBytes: submissions.sizeBytes,
      })
      .from(submissions)
      .where(eq(submissions.studentId, studentId))
      .orderBy(desc(submissions.receivedAt));
  }
}
