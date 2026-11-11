import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { classMembers, idempotencyKeys, labs, submissions } from './schema.js';

// These types mirror `SubmissionData` in apps/api/src/submissions/submission-data.ts
// (decisions.md D10). They are repeated here because a package must not import from an app;
// TypeScript checks the two shapes against each other where the API wires this adapter in.

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

export type Database = NodePgDatabase<typeof schema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A non-UUID would make PostgreSQL raise 22P02 (a 500); the contract answers it with 404. */
function isUuid(value: string): boolean {
  return UUID.test(value);
}

const storedColumns = {
  requestHash: idempotencyKeys.requestHash,
  expiresAt: idempotencyKeys.expiresAt,
  id: submissions.id,
  labId: submissions.labId,
  receivedAt: submissions.receivedAt,
  sizeBytes: submissions.sizeBytes,
};

type StoredRow = {
  requestHash: string;
  expiresAt: Date;
  id: string;
  labId: string;
  receivedAt: Date;
  sizeBytes: number;
};

/**
 * The receipt is rebuilt from immutable submission columns. `status` is always 'queued':
 * a replay returns the original response even after judging has moved on (contract, section 4.5).
 */
function toStored(row: StoredRow): StoredSubmission {
  return {
    requestHash: row.requestHash,
    expiresAt: row.expiresAt,
    receipt: {
      id: row.id,
      labId: row.labId,
      status: 'queued',
      receivedAt: row.receivedAt.toISOString(),
      sizeBytes: row.sizeBytes,
    },
  };
}

export class DrizzleSubmissionData {
  constructor(private readonly db: Database) {}

  /** One membership-filtered query: a missing lab and another class's lab both return null. */
  async findLabForStudent(studentId: string, labId: string): Promise<StudentLab | null> {
    if (!isUuid(studentId) || !isUuid(labId)) return null;
    // Theo FAQ-01: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-01
    const rows = await this.db
      .select({ id: labs.id, opensAt: labs.opensAt, deadlineAt: labs.deadlineAt })
      .from(labs)
      .innerJoin(
        classMembers,
        and(eq(classMembers.classId, labs.classId), eq(classMembers.userId, studentId)),
      )
      .where(eq(labs.id, labId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Returns the row even when expired: the caller compares expiresAt with its receivedAt. */
  async findIdempotencyKey(scope: IdempotencyScope): Promise<StoredSubmission | null> {
    if (!isUuid(scope.studentId) || !isUuid(scope.labId)) return null;
    const rows = await this.db
      .select(storedColumns)
      .from(idempotencyKeys)
      .innerJoin(submissions, eq(submissions.id, idempotencyKeys.submissionId))
      .where(
        and(
          eq(idempotencyKeys.studentId, scope.studentId),
          eq(idempotencyKeys.labId, scope.labId),
          eq(idempotencyKeys.key, scope.key),
        ),
      )
      .limit(1);
    return rows[0] ? toStored(rows[0]) : null;
  }

  /**
   * Inserts the submission and its key in one transaction (contract, section 4.5).
   * A transaction-scoped advisory lock on the scope serializes writers with the same
   * (student, lab, key), including the one that replaces an expired key, so exactly one wins.
   * A loser sees the winner's live row and gets it back with created: false; it writes nothing.
   */
  async insertSubmission(input: InsertSubmission): Promise<InsertResult> {
    const receivedAt = new Date(input.receipt.receivedAt);
    return this.db.transaction(async (tx) => {
      // UUIDs compare case-insensitively (contract, section 4.2), so the lock key uses lower case;
      // the Idempotency-Key itself is compared exactly, case included.
      const scopeText = JSON.stringify([
        input.studentId.toLowerCase(),
        input.labId.toLowerCase(),
        input.key,
      ]);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scopeText}, 0))`);

      const existing = await tx
        .select(storedColumns)
        .from(idempotencyKeys)
        .innerJoin(submissions, eq(submissions.id, idempotencyKeys.submissionId))
        .where(
          and(
            eq(idempotencyKeys.studentId, input.studentId),
            eq(idempotencyKeys.labId, input.labId),
            eq(idempotencyKeys.key, input.key),
          ),
        )
        .limit(1);
      const live = existing[0];
      // A key is live only while expiresAt > the incoming receivedAt; equality means expired.
      if (live && live.expiresAt.getTime() > receivedAt.getTime()) {
        return { created: false, stored: toStored(live) };
      }

      await tx.insert(submissions).values({
        id: input.receipt.id,
        labId: input.labId,
        studentId: input.studentId,
        source: input.source,
        sizeBytes: input.receipt.sizeBytes,
        status: 'queued',
        receivedAt,
      });
      await tx
        .insert(idempotencyKeys)
        .values({
          studentId: input.studentId,
          labId: input.labId,
          key: input.key,
          requestHash: input.requestHash,
          submissionId: input.receipt.id,
          expiresAt: input.expiresAt,
        })
        .onConflictDoUpdate({
          target: [idempotencyKeys.studentId, idempotencyKeys.labId, idempotencyKeys.key],
          set: {
            requestHash: input.requestHash,
            submissionId: input.receipt.id,
            expiresAt: input.expiresAt,
          },
        });

      return {
        created: true,
        stored: {
          requestHash: input.requestHash,
          expiresAt: input.expiresAt,
          receipt: input.receipt,
        },
      };
    });
  }

  /** Rows still 'queued' and received before `before`, for the outbox sweep (D6). */
  async listQueuedSubmissions(before: Date, limit: number): Promise<SubmissionReceipt[]> {
    const rows = await this.db
      .select({
        id: submissions.id,
        labId: submissions.labId,
        receivedAt: submissions.receivedAt,
        sizeBytes: submissions.sizeBytes,
      })
      .from(submissions)
      .where(and(eq(submissions.status, 'queued'), lt(submissions.receivedAt, before)))
      .orderBy(asc(submissions.receivedAt), asc(submissions.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      labId: row.labId,
      status: 'queued',
      receivedAt: row.receivedAt.toISOString(),
      sizeBytes: row.sizeBytes,
    }));
  }
}
