import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../../../packages/db/src/submission-data.js';
import {
  classMembers,
  labConstraints,
  labTestCases,
  labs,
} from '../../../../packages/db/src/schema.js';
import type { Principal } from '../common/request.js';
import type { LabDraft, Labs, LabSummary } from './labs.js';

export class PostgresLabs implements Labs {
  constructor(private readonly db: Database) {}

  async list(principal: Principal, classId: string): Promise<LabSummary[] | null> {
    // Theo FAQ-01: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-01
    const membership = await this.db
      .select({ userId: classMembers.userId })
      .from(classMembers)
      .where(and(eq(classMembers.classId, classId), eq(classMembers.userId, principal.id)))
      .limit(1);
    if (!membership.length) return null;
    const rows = await this.db.select().from(labs).where(eq(labs.classId, classId));
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const constraints = await this.db
      .select()
      .from(labConstraints)
      .where(inArray(labConstraints.labId, ids))
      .orderBy(labConstraints.position);
    // Theo FAQ-02: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-02
    const cases =
      principal.role === 'ta'
        ? await this.db
            .select()
            .from(labTestCases)
            .where(inArray(labTestCases.labId, ids))
            .orderBy(labTestCases.position)
        : [];
    return rows.map((row) => {
      const base = {
        id: row.id,
        classId: row.classId,
        title: row.title,
        opensAt: row.opensAt,
        deadlineAt: row.deadlineAt,
      };
      const visible = principal.role === 'ta' || row.opensAt <= new Date();
      if (!visible) return base;
      const labRules = constraints
        .filter((item) => item.labId === row.id)
        .map((item) => ({
          id: item.id,
          text: item.text,
          deduction: item.deductionHundredths / 100,
        }));
      const labCases = cases
        .filter((item) => item.labId === row.id)
        .map((item) => ({ input: item.input, expectedOutput: item.expectedOutput }));
      return {
        ...base,
        ...(row.statement
          ? {
              statement: row.statement,
              cpuLimitSeconds: row.cpuLimitSeconds,
              memoryLimitMb: row.memoryLimitMb,
            }
          : {}),
        ...(labRules.length ? { constraints: labRules } : {}),
        ...(labCases.length ? { testCases: labCases } : {}),
      };
    });
  }

  async create(principal: Principal, classId: string, lab: LabDraft): Promise<LabSummary | null> {
    if (principal.role !== 'ta') return null;
    return this.db.transaction(async (tx) => {
      const membership = await tx
        .select({ userId: classMembers.userId })
        .from(classMembers)
        .where(and(eq(classMembers.classId, classId), eq(classMembers.userId, principal.id)))
        .limit(1);
      if (!membership.length) return null;
      const record = {
        id: randomUUID(),
        classId,
        title: lab.title,
        opensAt: lab.opensAt,
        deadlineAt: lab.deadlineAt,
      };
      await tx.insert(labs).values({
        ...record,
        statement: lab.statement ?? '',
        cpuLimitSeconds: lab.cpuLimitSeconds ?? 1,
        memoryLimitMb: lab.memoryLimitMb ?? 256,
      });
      if (lab.constraints?.length)
        await tx.insert(labConstraints).values(
          lab.constraints.map((item, position) => ({
            id: randomUUID(),
            labId: record.id,
            text: item.text,
            deductionHundredths: Math.round(item.deduction * 100),
            position,
          })),
        );
      if (lab.testCases?.length)
        await tx.insert(labTestCases).values(
          lab.testCases.map((item, position) => ({
            id: randomUUID(),
            labId: record.id,
            input: item.input,
            expectedOutput: item.expectedOutput,
            position,
          })),
        );
      return record;
    });
  }
}
