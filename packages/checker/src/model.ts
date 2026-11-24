// What the checker needs from a model (D14). The Gemini client and the test fake both fit it.

export interface ModelRequest {
  prompt: string;
  /** Aborted when the time limit runs out; the client must cancel its request. */
  signal: AbortSignal;
}

export interface ModelResponse {
  /** The model's answer, which our own code checks against the schema. */
  text: string;
  /** The provider's id for this request, for the call log. */
  requestId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** List price of this call in whole nano-USD; absent when the model's price was not checked. */
  costNanoUsd?: number;
}

export interface Model {
  name: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelAnswer {
  verdict: 'pass' | 'violation' | 'unsure';
  evidence: { line: number; text: string }[];
  reason: string;
}

const VERDICTS = new Set(['pass', 'violation', 'unsure']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactly = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

/**
 * The model's answer if it is exactly the schema: `verdict`, `evidence` and `reason`, nothing more
 * (there is no deduction field). Null for anything else, which the caller turns into `unsure`.
 */
export function parseModelAnswer(text: string): ModelAnswer | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value) || !hasExactly(value, ['verdict', 'evidence', 'reason'])) return null;
  const { verdict, evidence, reason } = value;
  if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) return null;
  if (typeof reason !== 'string' || !Array.isArray(evidence)) return null;
  const entries: ModelAnswer['evidence'] = [];
  for (const entry of evidence) {
    if (!isObject(entry) || !hasExactly(entry, ['line', 'text'])) return null;
    if (!Number.isInteger(entry.line) || (entry.line as number) < 1) return null;
    if (typeof entry.text !== 'string') return null;
    entries.push({ line: entry.line as number, text: entry.text });
  }
  return { verdict: verdict as ModelAnswer['verdict'], evidence: entries, reason };
}
