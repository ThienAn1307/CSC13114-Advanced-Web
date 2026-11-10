/** Interface X calls and Y implements. No Drizzle or HTTP objects cross it. */
export interface StudentLab {
  id: string;
  opensAt: Date;
  deadlineAt: Date;
}

export interface SubmissionReceipt {
  id: string;
  labId: string;
  status: 'queued';
  receivedAt: string;
  sizeBytes: number;
}

export interface IdempotencyScope {
  studentId: string;
  labId: string;
  key: string;
}

export interface StoredSubmission {
  requestHash: string;
  receipt: SubmissionReceipt;
  expiresAt: Date;
}

export interface InsertSubmission extends IdempotencyScope, StoredSubmission {
  source: string;
}

export type InsertResult =
  { created: true; stored: StoredSubmission } | { created: false; stored: StoredSubmission };

export interface SubmissionData {
  /** One membership-filtered lookup; missing lab and non-membership both return null. */
  findLabForStudent(studentId: string, labId: string): Promise<StudentLab | null>;
  findIdempotencyKey(scope: IdempotencyScope): Promise<StoredSubmission | null>;
  /** Atomic insert of BOTH rows. Lock the scope; replace expired keys at receivedAt.
   * On a concurrent live key, return the winning record with created:false.
   * Never leave a losing submission row behind. Expiry uses the incoming receipt's receivedAt.
   */
  insertSubmission(input: InsertSubmission): Promise<InsertResult>;
  /** Durable queued rows for a later outbox sweep, ordered by receivedAt then id. */
  listQueuedSubmissions(before: Date, limit: number): Promise<SubmissionReceipt[]>;
}

export interface SubmissionQueue {
  /** Must deduplicate by submissionId (e.g. BullMQ jobId); enqueue contains no source or secrets. */
  enqueue(submissionId: string): Promise<void>;
}

export const SUBMISSION_DATA = Symbol('SUBMISSION_DATA');
export const SUBMISSION_QUEUE = Symbol('SUBMISSION_QUEUE');
