// The one function the worker and the checker command call (PA3-plan.md, interface 2).

import { decideBanList, type Evidence } from './hard-rules.ts';
import { parseModelAnswer, type Model, type ModelResponse } from './model.ts';
import { buildPrompt, promptLines, type Identity } from './prompt.ts';

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
  /** The student's name, email and id, replaced by placeholders before the code reaches the model (D15). */
  identity?: Identity;
}

export type CheckOptions =
  /** MODEL_OFF=1: no model client is created and no connection is opened. */
  { modelOff: true } | { modelOff: false; model: Model; timeoutMs: number };

export interface Verdict {
  constraintId: string;
  verdict: 'pass' | 'violation' | 'unsure';
  evidence: Evidence[];
  reason?: string;
  decidedBy: 'hard-rule' | 'model' | 'guardrail';
  unsureCause?: string;
}

/** One row of the call log (D14). */
export interface ModelCall {
  constraintId: string;
  /** The provider's request id; none when no answer came back. */
  requestId?: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  /** List price of the call in whole nano-USD (D14); the free tier is billed $0. */
  costNanoUsd?: number;
  ms: number;
  outcome: 'answered' | 'bad-schema' | 'evidence-mismatch' | 'timeout' | 'model-error';
  /** Why a call failed (HTTP status, network), for the team; never shown to the student. */
  error?: string;
}

export interface CheckResult {
  verdicts: Verdict[];
  /** One row per model call; empty with the model off. */
  calls: ModelCall[];
}

const unsure = (constraintId: string, unsureCause: string): Verdict => ({
  constraintId,
  verdict: 'unsure',
  evidence: [],
  decidedBy: 'guardrail',
  unsureCause,
});

class Timeout extends Error {}

/** The model's response, or a Timeout once `signal` is aborted, even if the model ignores the signal. */
function completeWithin(model: Model, prompt: string, timeoutMs: number): Promise<ModelResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Timeout()), timeoutMs);
  const timedOut = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Timeout()), { once: true });
  });
  return Promise.race([model.complete({ prompt, signal: controller.signal }), timedOut]).finally(
    () => clearTimeout(timer),
  );
}

async function askModel(
  input: CheckInput,
  constraint: Constraint,
  model: Model,
  timeoutMs: number,
): Promise<{ verdict: Verdict; call: ModelCall }> {
  const lines = promptLines(input.source, input.identity);
  const prompt = buildPrompt(input.statement, constraint.text, lines);
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  let response: ModelResponse;
  try {
    response = await completeWithin(model, prompt, timeoutMs);
  } catch (error) {
    const call: ModelCall = {
      constraintId: constraint.id,
      model: model.name,
      ms: ms(),
      outcome: 'timeout',
    };
    if (error instanceof Timeout) return { verdict: unsure(constraint.id, 'timeout'), call };
    // D14: a failed call (HTTP error, no connection) costs this pair only.
    const failed: ModelCall = { ...call, outcome: 'model-error', error: (error as Error).message };
    return { verdict: unsure(constraint.id, 'model-error'), call: failed };
  }

  const call: ModelCall = {
    constraintId: constraint.id,
    requestId: response.requestId,
    model: response.model,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    ...(response.costNanoUsd === undefined ? {} : { costNanoUsd: response.costNanoUsd }),
    ms: ms(),
    outcome: 'answered',
  };
  const answer = parseModelAnswer(response.text);
  if (!answer)
    return {
      verdict: unsure(constraint.id, 'bad-schema'),
      call: { ...call, outcome: 'bad-schema' },
    };

  // D15: each entry must match the line the model was shown; only then is the original line written.
  const shownAsPrompted = (e: { line: number; text: string }) =>
    lines[e.line - 1]?.trim() === e.text.trim();
  const noEvidenceForViolation = answer.verdict === 'violation' && answer.evidence.length === 0;
  if (noEvidenceForViolation || !answer.evidence.every(shownAsPrompted)) {
    return {
      verdict: unsure(constraint.id, 'evidence-mismatch'),
      call: { ...call, outcome: 'evidence-mismatch' },
    };
  }
  const original = input.source.split('\n');
  const verdict: Verdict = {
    constraintId: constraint.id,
    verdict: answer.verdict,
    evidence: answer.evidence.map(({ line }) => ({
      line,
      text: original[line - 1]!.replace(/\r$/, ''),
    })),
    reason: answer.reason,
    decidedBy: 'model',
  };
  if (answer.verdict === 'unsure') verdict.unsureCause = 'model-unsure';
  return { verdict, call };
}

/** One verdict per constraint, in the constraints' order. Hard rules first; the model never sees what they decided. */
export async function check(input: CheckInput, options: CheckOptions): Promise<CheckResult> {
  const verdicts: Verdict[] = [];
  const calls: ModelCall[] = [];
  for (const constraint of input.constraints) {
    const decided = decideBanList(constraint.text, input.source);
    if (decided) {
      verdicts.push({ constraintId: constraint.id, ...decided, decidedBy: 'hard-rule' });
    } else if (options.modelOff) {
      verdicts.push(unsure(constraint.id, 'model-off'));
    } else {
      const { verdict, call } = await askModel(input, constraint, options.model, options.timeoutMs);
      verdicts.push(verdict);
      calls.push(call);
    }
  }
  return { verdicts, calls };
}
