import type { Principal } from '../common/request.js';

export interface LabSummary {
  id: string;
  classId: string;
  title: string;
  opensAt: Date;
  deadlineAt: Date;
  statement?: string;
  cpuLimitSeconds?: number;
  memoryLimitMb?: number;
  constraints?: LabConstraint[];
  testCases?: LabTestCase[];
}
export interface LabConstraint {
  id: string;
  text: string;
  deduction: number;
}
export interface LabTestCase {
  input: string;
  expectedOutput: string;
}
export type LabDraft = Omit<LabSummary, 'id' | 'classId' | 'constraints'> & {
  constraints?: Omit<LabConstraint, 'id'>[];
};
export interface Labs {
  list(principal: Principal, classId: string): Promise<LabSummary[] | null>;
  create(principal: Principal, classId: string, lab: LabDraft): Promise<LabSummary | null>;
}
export const LABS = Symbol('LABS');
