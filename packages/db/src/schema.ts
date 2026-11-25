import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Timestamps keep milliseconds only: the contract truncates receivedAt to ms and
// compares that one value with the deadline (contract, section 3).
const ms = { withTimezone: true, precision: 3, mode: 'date' } as const;

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'),
    role: text('role', { enum: ['student', 'ta', 'admin'] }).notNull(),
    createdAt: timestamp('created_at', ms).notNull().defaultNow(),
  },
  (t) => [check('users_role_check', sql`${t.role} in ('student', 'ta', 'admin')`)],
);

export const classes = pgTable('classes', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
});

/** Students and TAs of a class (brief, section 4: TAs belong to classes). */
export const classMembers = pgTable(
  'class_members',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.userId] }),
    index('class_members_user_idx').on(t.userId),
  ],
);

export const labs = pgTable(
  'labs',
  {
    id: uuid('id').primaryKey(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    title: text('title').notNull(),
    statement: text('statement').notNull().default(''),
    cpuLimitSeconds: integer('cpu_limit_seconds').notNull().default(1),
    memoryLimitMb: integer('memory_limit_mb').notNull().default(256),
    opensAt: timestamp('opens_at', ms).notNull(),
    deadlineAt: timestamp('deadline_at', ms).notNull(),
  },
  (t) => [
    check('labs_window_check', sql`${t.deadlineAt} > ${t.opensAt}`),
    check('labs_cpu_limit_check', sql`${t.cpuLimitSeconds} between 1 and 5`),
    check('labs_memory_limit_check', sql`${t.memoryLimitMb} between 64 and 512`),
    index('labs_class_idx').on(t.classId),
  ],
);

/** Theo FAQ-06: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-06 */
export const labConstraints = pgTable(
  'lab_constraints',
  {
    id: uuid('id').primaryKey(),
    labId: uuid('lab_id')
      .notNull()
      .references(() => labs.id),
    text: text('text').notNull(),
    deductionHundredths: integer('deduction_hundredths').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    check('lab_constraints_deduction_check', sql`${t.deductionHundredths} between 0 and 1000`),
    index('lab_constraints_lab_idx').on(t.labId, t.position),
  ],
);

/** Hidden test data must never be returned to students (FAQ-02). */
export const labTestCases = pgTable(
  'lab_test_cases',
  {
    id: uuid('id').primaryKey(),
    labId: uuid('lab_id')
      .notNull()
      .references(() => labs.id),
    input: text('input').notNull(),
    expectedOutput: text('expected_output').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('lab_test_cases_lab_idx').on(t.labId, t.position)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey(),
    labId: uuid('lab_id')
      .notNull()
      .references(() => labs.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    source: text('source').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // The judge status (D11). The verdict itself (AC, WA, ...) is in judge_results.
    status: text('status', { enum: ['queued', 'judging', 'judged', 'failed'] })
      .notNull()
      .default('queued'),
    receivedAt: timestamp('received_at', ms).notNull(),
    attempts: integer('attempts').notNull().default(0),
    /** While judging: when another worker may claim the row again. */
    leaseUntil: timestamp('lease_until', ms),
    /** The worker that holds the row; null when it gave up and the row waits for a retry. */
    claimToken: uuid('claim_token'),
    /** For the TA only: why the row could not be judged. */
    failureCause: text('failure_cause'),
  },
  (t) => [
    check('submissions_size_check', sql`${t.sizeBytes} between 1 and 65536`),
    check(
      'submissions_status_check',
      sql`${t.status} in ('queued', 'judging', 'judged', 'failed')`,
    ),
    check(
      'submissions_lease_check',
      sql`(${t.status} = 'judging') = (${t.leaseUntil} is not null)`,
    ),
    check('submissions_token_check', sql`${t.claimToken} is null or ${t.status} = 'judging'`),
    check(
      'submissions_failure_check',
      sql`(${t.status} = 'failed') = (${t.failureCause} is not null)`,
    ),
    index('submissions_lab_student_idx').on(t.labId, t.studentId, t.receivedAt),
    // The claim (D11) reads unfinished rows, oldest first. Finished rows are not in the index.
    index('submissions_claimable_idx')
      .on(t.receivedAt, t.id)
      .where(sql`${t.status} in ('queued', 'judging')`),
  ],
);

/** The judge records the overall result before the checker is allowed to propose verdicts. */
export const judgeResults = pgTable(
  'judge_results',
  {
    submissionId: uuid('submission_id')
      .primaryKey()
      .references(() => submissions.id),
    status: text('status', { enum: ['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE'] }).notNull(),
    finishedAt: timestamp('finished_at', ms).notNull(),
  },
  (t) => [
    check('judge_results_status_check', sql`${t.status} in ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE')`),
  ],
);

/** Only the verdict is exposed to the student; inputs and outputs remain in lab_test_cases. */
export const judgeTestResults = pgTable(
  'judge_test_results',
  {
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => judgeResults.submissionId),
    position: integer('position').notNull(),
    status: text('status', { enum: ['AC', 'WA', 'TLE', 'MLE', 'RE'] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.position] }),
    check('judge_test_results_position_check', sql`${t.position} > 0`),
    check('judge_test_results_status_check', sql`${t.status} in ('AC', 'WA', 'TLE', 'MLE', 'RE')`),
  ],
);

/** One row per Accepted submission, claimed by the check worker (D12). Never shown to the student. */
export const checkJobs = pgTable(
  'check_jobs',
  {
    submissionId: uuid('submission_id')
      .primaryKey()
      .references(() => submissions.id),
    status: text('status', { enum: ['queued', 'checking', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    createdAt: timestamp('created_at', ms).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    leaseUntil: timestamp('lease_until', ms),
    claimToken: uuid('claim_token'),
    failureCause: text('failure_cause'),
  },
  (t) => [
    check('check_jobs_status_check', sql`${t.status} in ('queued', 'checking', 'done', 'failed')`),
    check(
      'check_jobs_lease_check',
      sql`(${t.status} = 'checking') = (${t.leaseUntil} is not null)`,
    ),
    check('check_jobs_token_check', sql`${t.claimToken} is null or ${t.status} = 'checking'`),
    check(
      'check_jobs_failure_check',
      sql`(${t.status} = 'failed') = (${t.failureCause} is not null)`,
    ),
    index('check_jobs_claimable_idx')
      .on(t.createdAt, t.submissionId)
      .where(sql`${t.status} in ('queued', 'checking')`),
  ],
);

/**
 * The call log: one row per model call (D14), for the team only. The row is written before the
 * call, so a call cut short by a crash still counts towards the lab's cap (D8).
 */
export const modelCalls = pgTable(
  'model_calls',
  {
    id: uuid('id').primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    labId: uuid('lab_id')
      .notNull()
      .references(() => labs.id),
    constraintId: uuid('constraint_id')
      .notNull()
      .references(() => labConstraints.id),
    /** The check job's attempt that made the call. */
    attempt: integer('attempt').notNull(),
    model: text('model').notNull(),
    /** Exactly what was sent: no comments and no identity (D15). */
    prompt: text('prompt').notNull(),
    startedAt: timestamp('started_at', ms).notNull().defaultNow(),
    /** The provider's id; null when no answer came back. */
    requestId: text('request_id'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costNanoUsd: bigint('cost_nano_usd', { mode: 'number' }),
    ms: integer('ms'),
    outcome: text('outcome', {
      enum: ['started', 'answered', 'bad-schema', 'evidence-mismatch', 'timeout', 'model-error'],
    })
      .notNull()
      .default('started'),
    error: text('error'),
  },
  (t) => [
    check(
      'model_calls_outcome_check',
      sql`${t.outcome} in ('started', 'answered', 'bad-schema', 'evidence-mismatch', 'timeout', 'model-error')`,
    ),
    index('model_calls_lab_idx').on(t.labId),
    index('model_calls_submission_idx').on(t.submissionId),
  ],
);

export const reviewProposals = pgTable(
  'review_proposals',
  {
    id: uuid('id').primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    constraintId: uuid('constraint_id')
      .notNull()
      .references(() => labConstraints.id),
    verdict: text('verdict', { enum: ['pass', 'violation', 'unsure'] }).notNull(),
    evidence: jsonb('evidence').$type<{ line: number; text: string }[]>().notNull(),
    reason: text('reason'),
    decidedBy: text('decided_by', { enum: ['hard-rule', 'model', 'guardrail'] }).notNull(),
    unsureCause: text('unsure_cause'),
    decision: text('decision', { enum: ['pass', 'violation'] }),
    revision: integer('revision').notNull().default(0),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', ms),
    reviewEvidence: jsonb('review_evidence').$type<{ line: number; text: string }[]>(),
  },
  (t) => [
    uniqueIndex('review_proposals_submission_constraint_idx').on(t.submissionId, t.constraintId),
    check('review_proposals_verdict_check', sql`${t.verdict} in ('pass', 'violation', 'unsure')`),
    check(
      'review_proposals_decision_check',
      sql`${t.decision} is null or ${t.decision} in ('pass', 'violation')`,
    ),
    check(
      'review_proposals_decided_by_check',
      sql`${t.decidedBy} in ('hard-rule', 'model', 'guardrail')`,
    ),
  ],
);

/** Theo FAQ-10: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-10 */
export const reviewDecisionEvents = pgTable(
  'review_decision_events',
  {
    id: uuid('id').primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => reviewProposals.id),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    previousDecision: text('previous_decision', { enum: ['pass', 'violation'] }),
    decision: text('decision', { enum: ['pass', 'violation'] }).notNull(),
    revision: integer('revision').notNull(),
    evidence: jsonb('evidence').$type<{ line: number; text: string }[]>().notNull(),
    recordedAt: timestamp('recorded_at', ms).notNull(),
  },
  (t) => [uniqueIndex('review_decision_events_revision_idx').on(t.proposalId, t.revision)],
);

/**
 * One row per (student, lab, key). Only a 202 is stored (contract, section 4.5).
 * An expired row is replaced in place by the next successful submission with the same key;
 * the submission it pointed to stays.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    labId: uuid('lab_id')
      .notNull()
      .references(() => labs.id),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    submissionId: uuid('submission_id')
      .notNull()
      .unique()
      .references(() => submissions.id),
    expiresAt: timestamp('expires_at', ms).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.labId, t.key] }),
    check('idempotency_keys_hash_check', sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
    // Contract, section 4.2: 1 to 255 visible ASCII characters.
    check('idempotency_keys_key_check', sql`${t.key} ~ '^[!-~]{1,255}$'`),
  ],
);
