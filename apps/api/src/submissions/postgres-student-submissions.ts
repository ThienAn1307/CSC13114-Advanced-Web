import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../../../packages/db/src/submission-data.js';
import { judgeResults, judgeTestResults, submissions } from '../../../../packages/db/src/schema.js';
import type { StudentSubmissions, StudentSubmissionStatus } from './student-submissions.js';

export class PostgresStudentSubmissions implements StudentSubmissions {
  constructor(private readonly db: Database) {}

  async list(studentId: string): Promise<StudentSubmissionStatus[]> {
    // Theo FAQ-08: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-08
    return this.db
      .select({
        id: submissions.id,
        labId: submissions.labId,
        status: sql<string>`coalesce(${judgeResults.status}, ${submissions.status})`,
        receivedAt: submissions.receivedAt,
        sizeBytes: submissions.sizeBytes,
      })
      .from(submissions)
      .leftJoin(judgeResults, eq(judgeResults.submissionId, submissions.id))
      .where(eq(submissions.studentId, studentId))
      .orderBy(desc(submissions.receivedAt));
  }

  async listTests(
    studentId: string,
    submissionId: string,
  ): Promise<{ position: number; status: string }[] | null> {
    const owned = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.id, submissionId), eq(submissions.studentId, studentId)))
      .limit(1);
    if (!owned.length) return null;
    return this.db
      .select({ position: judgeTestResults.position, status: judgeTestResults.status })
      .from(judgeTestResults)
      .where(eq(judgeTestResults.submissionId, submissionId))
      .orderBy(judgeTestResults.position);
  }
}
