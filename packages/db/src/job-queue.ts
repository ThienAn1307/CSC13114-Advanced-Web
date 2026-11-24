import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { PostgresReviewQueue } from './review-queue.js';
import type { ReviewProposal } from './review-queue.js';
import {
  checkJobs,
  judgeResults,
  judgeTestResults,
  labTestCases,
  labs,
  submissions,
} from './schema.js';
import type { Database } from './submission-data.js';

/** A row claimed this many times is not tried again (D11). */
export const MAX_ATTEMPTS = 3;
/** The cause when the last worker that claimed the row never came back. */
const WORKER_LOST = 'worker-lost';

/** What a worker holds. Every write names the token, so a worker that lost the row writes nothing. */
export interface Claim {
  submissionId: string;
  token: string;
  attempts: number;
}

export interface JudgeOutcome {
  status: 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE';
  /** One status per test, in the lab's order; empty for a compile error. */
  tests: ('AC' | 'WA' | 'TLE' | 'MLE' | 'RE')[];
}

/** What the judge needs to judge one submission: never who sent it. */
export interface JudgeTask {
  source: string;
  /** In the lab's order. */
  cases: { input: string; expectedOutput: string }[];
  cpuSeconds: number;
  memoryMb: number;
}

/** `lost`: another worker holds the row now, and nothing was written. */
export type GiveUpResult = 'retry' | 'failed' | 'lost';

// Leases are set and compared on the database's clock, so workers' clocks need not agree.
const leaseEnd = (leaseMs: number) => sql`now() + ${leaseMs} * interval '1 millisecond'`;
const FREE = { claimToken: null, leaseUntil: null };

/** Submissions waiting for the judge; the submission row is the job (D11). */
export class JudgeQueue {
  constructor(private readonly db: Database) {}

  /** The oldest row that is queued or whose lease ran out, or null. */
  async claim(leaseMs: number): Promise<Claim | null> {
    const t = submissions;
    return this.db.transaction(async (tx) => {
      const claimable = or(
        eq(t.status, 'queued'),
        and(eq(t.status, 'judging'), lt(t.leaseUntil, sql`now()`)),
      );
      const spent = tx
        .select({ id: t.id })
        .from(t)
        .where(and(claimable, gte(t.attempts, MAX_ATTEMPTS)))
        .for('update', { skipLocked: true });
      await tx
        .update(t)
        .set({ status: 'failed', failureCause: WORKER_LOST, ...FREE })
        .where(inArray(t.id, spent));

      const [next] = await tx
        .select({ id: t.id })
        .from(t)
        .where(and(claimable, lt(t.attempts, MAX_ATTEMPTS)))
        .orderBy(asc(t.receivedAt), asc(t.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!next) return null;

      const token = randomUUID();
      const [row] = await tx
        .update(t)
        .set({
          status: 'judging',
          claimToken: token,
          leaseUntil: leaseEnd(leaseMs),
          attempts: sql`${t.attempts} + 1`,
        })
        .where(eq(t.id, next.id))
        .returning({ attempts: t.attempts });
      return { submissionId: next.id, token, attempts: row!.attempts };
    });
  }

  async task(submissionId: string): Promise<JudgeTask> {
    const [found] = await this.db
      .select({
        labId: labs.id,
        source: submissions.source,
        cpuSeconds: labs.cpuLimitSeconds,
        memoryMb: labs.memoryLimitMb,
      })
      .from(submissions)
      .innerJoin(labs, eq(labs.id, submissions.labId))
      .where(eq(submissions.id, submissionId));
    if (!found) throw new Error('Submission not found.');
    const { labId, ...task } = found;
    const cases = await this.db
      .select({ input: labTestCases.input, expectedOutput: labTestCases.expectedOutput })
      .from(labTestCases)
      .where(eq(labTestCases.labId, labId))
      .orderBy(asc(labTestCases.position));
    return { ...task, cases };
  }

  /** Extends the lease; false when another worker holds the row. */
  async renew(claim: Claim, leaseMs: number): Promise<boolean> {
    const rows = await this.db
      .update(submissions)
      .set({ leaseUntil: leaseEnd(leaseMs) })
      .where(this.held(claim))
      .returning({ id: submissions.id });
    return rows.length === 1;
  }

  /**
   * Writes the result, the per-test results and, for an Accepted submission, its check job (D12),
   * in one transaction with the status change. False, and nothing written, when the claim is lost.
   */
  async complete(claim: Claim, outcome: JudgeOutcome): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const { submissionId } = claim;
      const rows = await tx
        .update(submissions)
        .set({ status: 'judged', ...FREE })
        .where(this.held(claim))
        .returning({ id: submissions.id });
      if (rows.length === 0) return false;
      await tx
        .insert(judgeResults)
        .values({ submissionId, status: outcome.status, finishedAt: sql`now()` });
      if (outcome.tests.length > 0) {
        await tx
          .insert(judgeTestResults)
          .values(outcome.tests.map((status, i) => ({ submissionId, position: i + 1, status })));
      }
      // Theo FAQ-04: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-04
      if (outcome.status === 'AC') await tx.insert(checkJobs).values({ submissionId });
      return true;
    });
  }

  /** The worker could not judge the row: try again after `retryMs`, or fail it on the last attempt. */
  async giveUp(claim: Claim, cause: string, retryMs: number): Promise<GiveUpResult> {
    const last = claim.attempts >= MAX_ATTEMPTS;
    const rows = await this.db
      .update(submissions)
      .set(
        last
          ? { status: 'failed', failureCause: cause, ...FREE }
          : { claimToken: null, leaseUntil: leaseEnd(retryMs) },
      )
      .where(this.held(claim))
      .returning({ id: submissions.id });
    if (rows.length === 0) return 'lost';
    return last ? 'failed' : 'retry';
  }

  private held(claim: Claim) {
    return and(eq(submissions.id, claim.submissionId), eq(submissions.claimToken, claim.token));
  }
}

/** Accepted submissions waiting for the constraint checker, claimed the same way (D12). */
export class CheckQueue {
  constructor(private readonly db: Database) {}

  async claim(leaseMs: number): Promise<Claim | null> {
    const t = checkJobs;
    return this.db.transaction(async (tx) => {
      const claimable = or(
        eq(t.status, 'queued'),
        and(eq(t.status, 'checking'), lt(t.leaseUntil, sql`now()`)),
      );
      const spent = tx
        .select({ id: t.submissionId })
        .from(t)
        .where(and(claimable, gte(t.attempts, MAX_ATTEMPTS)))
        .for('update', { skipLocked: true });
      await tx
        .update(t)
        .set({ status: 'failed', failureCause: WORKER_LOST, ...FREE })
        .where(inArray(t.submissionId, spent));

      const [next] = await tx
        .select({ id: t.submissionId })
        .from(t)
        .where(and(claimable, lt(t.attempts, MAX_ATTEMPTS)))
        .orderBy(asc(t.createdAt), asc(t.submissionId))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!next) return null;

      const token = randomUUID();
      const [row] = await tx
        .update(t)
        .set({
          status: 'checking',
          claimToken: token,
          leaseUntil: leaseEnd(leaseMs),
          attempts: sql`${t.attempts} + 1`,
        })
        .where(eq(t.submissionId, next.id))
        .returning({ attempts: t.attempts });
      return { submissionId: next.id, token, attempts: row!.attempts };
    });
  }

  async renew(claim: Claim, leaseMs: number): Promise<boolean> {
    const rows = await this.db
      .update(checkJobs)
      .set({ leaseUntil: leaseEnd(leaseMs) })
      .where(this.held(claim))
      .returning({ id: checkJobs.submissionId });
    return rows.length === 1;
  }

  /**
   * Stores the proposals in the TA's review queue (D18) and finishes the job in one transaction.
   * False, and nothing written, when the claim is lost.
   */
  async complete(claim: Claim, proposals: ReviewProposal[]): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(checkJobs)
        .set({ status: 'done', ...FREE })
        .where(this.held(claim))
        .returning({ id: checkJobs.submissionId });
      if (rows.length === 0) return false;
      await new PostgresReviewQueue(tx).storeProposals(claim.submissionId, proposals);
      return true;
    });
  }

  async giveUp(claim: Claim, cause: string, retryMs: number): Promise<GiveUpResult> {
    const last = claim.attempts >= MAX_ATTEMPTS;
    const rows = await this.db
      .update(checkJobs)
      .set(
        last
          ? { status: 'failed', failureCause: cause, ...FREE }
          : { claimToken: null, leaseUntil: leaseEnd(retryMs) },
      )
      .where(this.held(claim))
      .returning({ id: checkJobs.submissionId });
    if (rows.length === 0) return 'lost';
    return last ? 'failed' : 'retry';
  }

  private held(claim: Claim) {
    return and(
      eq(checkJobs.submissionId, claim.submissionId),
      eq(checkJobs.claimToken, claim.token),
    );
  }
}
