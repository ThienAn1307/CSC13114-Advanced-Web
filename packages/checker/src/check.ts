// The one function the worker and the checker command call (PA3-plan.md, interface 2).

import { decideBanList, type Evidence } from './hard-rules.ts';

export interface Constraint {
  id: string;
  text: string;
  /** Points out of 10 the TA takes off; shown to the TA, never used to decide a verdict. */
  deduction: number;
}

export interface CheckInput {
  statement: string;
  constraints: Constraint[];
  source: string;
}

export interface CheckOptions {
  /** MODEL_OFF=1: no model client is created and no connection is opened. */
  modelOff: boolean;
}

export interface Verdict {
  constraintId: string;
  verdict: 'pass' | 'violation' | 'unsure';
  evidence: Evidence[];
  reason?: string;
  decidedBy: 'hard-rule' | 'model' | 'guardrail';
  unsureCause?: string;
}

export interface CheckResult {
  verdicts: Verdict[];
  /** One row per model call (D14); empty with the model off. */
  calls: never[];
}

/** One verdict per constraint, in the constraints' order. Hard rules first; the model never sees what they decided. */
export async function check(input: CheckInput, options: CheckOptions): Promise<CheckResult> {
  if (!options.modelOff) {
    throw new Error('the model path is not built yet; run with the model off (MODEL_OFF=1)');
  }
  const verdicts = input.constraints.map((constraint): Verdict => {
    const decided = decideBanList(constraint.text, input.source);
    if (decided) return { constraintId: constraint.id, ...decided, decidedBy: 'hard-rule' };
    return {
      constraintId: constraint.id,
      verdict: 'unsure',
      evidence: [],
      decidedBy: 'guardrail',
      unsureCause: 'model-off',
    };
  });
  return Promise.resolve({ verdicts, calls: [] });
}
