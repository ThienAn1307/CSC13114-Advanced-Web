import type {
  IdempotencyScope,
  InsertResult,
  InsertSubmission,
  StoredSubmission,
  StudentLab,
  SubmissionData,
  SubmissionReceipt,
} from '../src/submissions/submission-data.js';

export const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
export const LAB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Test fake only: NOT a persistence implementation or a replacement for Y's transaction tests. */
export class FakeSubmissionData implements SubmissionData {
  lab: StudentLab | null = null;
  records = new Map<string, StoredSubmission>();
  submissions: InsertSubmission[] = [];
  failure = false;
  reads = 0;

  reset(): void {
    this.lab = {
      id: LAB_ID,
      opensAt: new Date(Date.now() - 60000),
      deadlineAt: new Date(Date.now() + 60000),
    };
    this.records.clear();
    this.submissions = [];
    this.failure = false;
    this.reads = 0;
  }

  findLabForStudent(studentId: string, labId: string): Promise<StudentLab | null> {
    this.reads++;
    if (this.failure)
      return Promise.reject(new Error('Database unavailable: private implementation detail.'));
    return Promise.resolve(studentId === STUDENT_ID && labId === LAB_ID ? this.lab : null);
  }

  findIdempotencyKey(scope: IdempotencyScope): Promise<StoredSubmission | null> {
    return Promise.resolve(this.records.get(this.scopeKey(scope)) ?? null);
  }

  insertSubmission(input: InsertSubmission): Promise<InsertResult> {
    const key = this.scopeKey(input);
    const stored = this.records.get(key);
    if (stored && stored.expiresAt > new Date(input.receipt.receivedAt))
      return Promise.resolve({ created: false, stored });
    const record = {
      requestHash: input.requestHash,
      receipt: input.receipt,
      expiresAt: input.expiresAt,
    };
    this.records.set(key, record);
    this.submissions.push(input);
    return Promise.resolve({ created: true, stored: record });
  }

  listQueuedSubmissions(before: Date, limit: number): Promise<SubmissionReceipt[]> {
    return Promise.resolve(
      this.submissions
        .map(({ receipt }) => receipt)
        .filter((receipt) => new Date(receipt.receivedAt) < before)
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id))
        .slice(0, limit),
    );
  }

  private scopeKey(scope: IdempotencyScope): string {
    return JSON.stringify([scope.studentId, scope.labId, scope.key]);
  }
}
