import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
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
    opensAt: timestamp('opens_at', ms).notNull(),
    deadlineAt: timestamp('deadline_at', ms).notNull(),
  },
  (t) => [
    check('labs_window_check', sql`${t.deadlineAt} > ${t.opensAt}`),
    index('labs_class_idx').on(t.classId),
  ],
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
    // Only 'queued' exists in PA#2; judging states arrive with the worker in PA#3.
    status: text('status', { enum: ['queued'] })
      .notNull()
      .default('queued'),
    receivedAt: timestamp('received_at', ms).notNull(),
  },
  (t) => [
    check('submissions_size_check', sql`${t.sizeBytes} between 1 and 65536`),
    check('submissions_status_check', sql`${t.status} in ('queued')`),
    index('submissions_lab_student_idx').on(t.labId, t.studentId, t.receivedAt),
    // The outbox sweep reads queued rows in (receivedAt, id) order.
    index('submissions_queued_idx')
      .on(t.receivedAt, t.id)
      .where(sql`${t.status} = 'queued'`),
  ],
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
