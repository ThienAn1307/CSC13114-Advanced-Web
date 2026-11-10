import type { Database } from './submission-data.js';
import { classMembers, classes, labs, users } from './schema.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Fixed ids, so contract tests and manual requests can name them. Every case the contract
 * cares about has a row: a lab that is open, one not open yet, one closed, and one lab of a
 * class the student does not belong to (404 lab-not-found, FAQ-01).
 */
export const SEED = {
  classes: {
    sorting: '00000000-0000-4000-8000-0000000c1a55',
    other: '00000000-0000-4000-8000-0000000c1a56',
  },
  users: {
    student: '00000000-0000-4000-8000-00000000a001',
    classmate: '00000000-0000-4000-8000-00000000a002',
    otherStudent: '00000000-0000-4000-8000-00000000a003',
    ta: '00000000-0000-4000-8000-00000000b001',
    admin: '00000000-0000-4000-8000-00000000c001',
  },
  labs: {
    open: '00000000-0000-4000-8000-0000000001ab',
    notOpen: '00000000-0000-4000-8000-0000000002ab',
    closed: '00000000-0000-4000-8000-0000000003ab',
    otherClass: '00000000-0000-4000-8000-0000000004ab',
  },
} as const;

/**
 * Writes the seed rows. Safe to run again: users, classes and memberships are kept, and the
 * lab windows move with `now` so "open" stays open. Contains no secrets and no real people.
 */
export async function seed(db: Database, now: Date): Promise<void> {
  const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY);
  const { classes: c, users: u, labs: l } = SEED;

  await db.transaction(async (tx) => {
    await tx
      .insert(classes)
      .values([
        { id: c.sorting, code: 'CSC10002-SORT', name: 'Intro C++: Sorting lab' },
        { id: c.other, code: 'CSC10002-OTHER', name: 'Intro C++: another class' },
      ])
      .onConflictDoNothing();

    await tx
      .insert(users)
      .values([
        { id: u.student, email: 'student@leetkob.test', displayName: 'Student A', role: 'student' },
        {
          id: u.classmate,
          email: 'classmate@leetkob.test',
          displayName: 'Student B',
          role: 'student',
        },
        {
          id: u.otherStudent,
          email: 'other@leetkob.test',
          displayName: 'Student C',
          role: 'student',
        },
        { id: u.ta, email: 'ta@leetkob.test', displayName: 'TA', role: 'ta' },
        { id: u.admin, email: 'admin@leetkob.test', displayName: 'Admin', role: 'admin' },
      ])
      .onConflictDoNothing();

    await tx
      .insert(classMembers)
      .values([
        { classId: c.sorting, userId: u.student },
        { classId: c.sorting, userId: u.classmate },
        { classId: c.sorting, userId: u.ta },
        { classId: c.other, userId: u.otherStudent },
      ])
      .onConflictDoNothing();

    const labRows = [
      { id: l.open, classId: c.sorting, title: 'Merge sort', opensAt: at(-1), deadlineAt: at(7) },
      { id: l.notOpen, classId: c.sorting, title: 'Quick sort', opensAt: at(1), deadlineAt: at(8) },
      {
        id: l.closed,
        classId: c.sorting,
        title: 'Bubble sort',
        opensAt: at(-8),
        deadlineAt: at(-1),
      },
      {
        id: l.otherClass,
        classId: c.other,
        title: 'Heap sort',
        opensAt: at(-1),
        deadlineAt: at(7),
      },
    ];
    for (const lab of labRows) {
      await tx
        .insert(labs)
        .values(lab)
        .onConflictDoUpdate({
          target: labs.id,
          set: { opensAt: lab.opensAt, deadlineAt: lab.deadlineAt },
        });
    }
  });
}
