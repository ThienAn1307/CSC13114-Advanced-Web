import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  classMembers,
  judgeResults,
  labConstraints,
  labs,
  reviewDecisionEvents,
  reviewProposals,
  submissions,
  users,
} from './schema.js';
import type { Database } from './submission-data.js';

export interface Evidence {
  line: number;
  text: string;
}
export interface ReviewProposal {
  constraintId: string;
  verdict: 'pass' | 'violation' | 'unsure';
  evidence: Evidence[];
  reason?: string;
  decidedBy: 'hard-rule' | 'model' | 'guardrail';
  unsureCause?: string;
}
export interface ReviewPrincipal {
  id: string;
  role: 'student' | 'ta' | 'admin';
}

function matchesSource(evidence: Evidence[], source: string): boolean {
  const lines = source.split('\n');
  return evidence.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      Number.isInteger(item.line) &&
      item.line > 0 &&
      typeof item.text === 'string' &&
      lines[item.line - 1]?.replace(/\r$/, '').trim() === item.text.trim(),
  );
}

/** Stores proposals only for an Accepted submission and constraints belonging to its lab. */
export class PostgresReviewQueue {
  constructor(private readonly db: Database) {}

  async storeProposals(submissionId: string, proposals: ReviewProposal[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [submission] = await tx
        .select({
          labId: submissions.labId,
          source: submissions.source,
          status: judgeResults.status,
        })
        .from(submissions)
        .innerJoin(judgeResults, eq(judgeResults.submissionId, submissions.id))
        .where(eq(submissions.id, submissionId))
        .limit(1);
      if (!submission || submission.status !== 'AC') throw new Error('Submission is not Accepted.');
      if (!proposals.length) return;
      const ids = proposals.map((item) => item.constraintId);
      if (new Set(ids).size !== ids.length) throw new Error('Duplicate constraint proposal.');
      const constraints = await tx
        .select({ id: labConstraints.id })
        .from(labConstraints)
        .where(and(eq(labConstraints.labId, submission.labId), inArray(labConstraints.id, ids)));
      if (constraints.length !== ids.length)
        throw new Error('Constraint does not belong to the submission lab.');
      for (const proposal of proposals) {
        if (
          !['pass', 'violation', 'unsure'].includes(proposal.verdict) ||
          !['hard-rule', 'model', 'guardrail'].includes(proposal.decidedBy) ||
          !Array.isArray(proposal.evidence) ||
          (proposal.verdict === 'unsure' &&
            (typeof proposal.unsureCause !== 'string' || !proposal.unsureCause.trim())) ||
          (proposal.verdict === 'violation' && proposal.evidence.length === 0) ||
          !matchesSource(proposal.evidence, submission.source)
        ) {
          throw new Error('Invalid proposal evidence.');
        }
      }
      await tx
        .insert(reviewProposals)
        .values(
          proposals.map((item) => ({
            id: randomUUID(),
            submissionId,
            constraintId: item.constraintId,
            verdict: item.verdict,
            evidence: item.evidence,
            reason: item.reason ?? null,
            decidedBy: item.decidedBy,
            unsureCause: item.unsureCause ?? null,
          })),
        )
        .onConflictDoNothing({
          target: [reviewProposals.submissionId, reviewProposals.constraintId],
        });
    });
  }

  async list(principal: ReviewPrincipal, classId: string) {
    if (principal.role !== 'ta') return null;
    const membership = await this.db
      .select({ id: classMembers.userId })
      .from(classMembers)
      .where(and(eq(classMembers.classId, classId), eq(classMembers.userId, principal.id)))
      .limit(1);
    if (!membership.length) return null;
    const rows = await this.db
      .select({
        id: reviewProposals.id,
        submissionId: reviewProposals.submissionId,
        constraintId: reviewProposals.constraintId,
        verdict: reviewProposals.verdict,
        evidence: reviewProposals.evidence,
        reason: reviewProposals.reason,
        decidedBy: reviewProposals.decidedBy,
        unsureCause: reviewProposals.unsureCause,
        decision: reviewProposals.decision,
        reviewEvidence: reviewProposals.reviewEvidence,
        source: submissions.source,
        studentId: submissions.studentId,
        studentName: users.displayName,
        labId: labs.id,
        labTitle: labs.title,
        constraint: labConstraints.text,
        deductionHundredths: labConstraints.deductionHundredths,
      })
      .from(reviewProposals)
      .innerJoin(submissions, eq(reviewProposals.submissionId, submissions.id))
      .innerJoin(labs, eq(submissions.labId, labs.id))
      .innerJoin(users, eq(submissions.studentId, users.id))
      .innerJoin(labConstraints, eq(reviewProposals.constraintId, labConstraints.id))
      // Theo FAQ-02: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-02
      .where(
        and(
          eq(labs.classId, classId),
          sql`not exists (
        select 1 from submissions newer
        where newer.lab_id = ${submissions.labId} and newer.student_id = ${submissions.studentId}
          and (newer.received_at, newer.id) > (${submissions.receivedAt}, ${submissions.id})
      )`,
        ),
      );
    const events = rows.length
      ? await this.db
          .select({
            proposalId: reviewDecisionEvents.proposalId,
            reviewerId: reviewDecisionEvents.reviewerId,
            previousDecision: reviewDecisionEvents.previousDecision,
            decision: reviewDecisionEvents.decision,
            evidence: reviewDecisionEvents.evidence,
            recordedAt: reviewDecisionEvents.recordedAt,
          })
          .from(reviewDecisionEvents)
          .where(
            inArray(
              reviewDecisionEvents.proposalId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(reviewDecisionEvents.revision)
      : [];
    return rows.map(({ deductionHundredths, ...row }) => ({
      ...row,
      deduction: deductionHundredths / 100,
      history: events
        .filter((event) => event.proposalId === row.id)
        .map((event) => ({
          reviewerId: event.reviewerId,
          previousDecision: event.previousDecision,
          decision: event.decision,
          evidence: event.evidence,
          recordedAt: event.recordedAt,
        })),
    }));
  }

  async decide(
    principal: ReviewPrincipal,
    classId: string,
    proposalId: string,
    decision: 'pass' | 'violation',
    evidence: Evidence[],
  ): Promise<'unavailable' | 'invalid' | { decision: 'pass' | 'violation' }> {
    if (principal.role !== 'ta') return 'unavailable';
    if (decision !== 'pass' && decision !== 'violation') return 'invalid';
    return this.db.transaction(async (tx) => {
      const membership = await tx
        .select({ id: classMembers.userId })
        .from(classMembers)
        .where(and(eq(classMembers.classId, classId), eq(classMembers.userId, principal.id)))
        .limit(1);
      if (!membership.length) return 'unavailable';
      const [proposal] = await tx
        .select({
          id: reviewProposals.id,
          previousDecision: reviewProposals.decision,
          revision: reviewProposals.revision,
          source: submissions.source,
        })
        .from(reviewProposals)
        .innerJoin(submissions, eq(reviewProposals.submissionId, submissions.id))
        .innerJoin(labs, eq(submissions.labId, labs.id))
        .where(
          and(
            eq(reviewProposals.id, proposalId),
            eq(labs.classId, classId),
            sql`not exists (
          select 1 from submissions newer
          where newer.lab_id = ${submissions.labId} and newer.student_id = ${submissions.studentId}
            and (newer.received_at, newer.id) > (${submissions.receivedAt}, ${submissions.id})
        )`,
          ),
        )
        .for('update', { of: reviewProposals });
      if (!proposal) return 'unavailable';
      if (
        !Array.isArray(evidence) ||
        (decision === 'violation' && evidence.length === 0) ||
        !matchesSource(evidence, proposal.source)
      )
        return 'invalid';
      const reviewedAt = new Date();
      const revision = proposal.revision + 1;
      await tx
        .update(reviewProposals)
        .set({ decision, revision, reviewEvidence: evidence, reviewedBy: principal.id, reviewedAt })
        .where(eq(reviewProposals.id, proposal.id));
      await tx.insert(reviewDecisionEvents).values({
        id: randomUUID(),
        proposalId,
        reviewerId: principal.id,
        previousDecision: proposal.previousDecision,
        decision,
        revision,
        evidence,
        recordedAt: reviewedAt,
      });
      return { decision };
    });
  }
}
