// PA#3 criterion 5, the first limits: model output that breaks the schema becomes unsure, and so
// does no answer in time (D14, FAQ-09). Fake model only: these tests never reach the network.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { check } from '../src/check.ts';
import { fakeModel, never } from './fake-model.ts';

const statement = '# Sorting\n\nRead `n` integers and print them in non-decreasing order.\n';
const MERGE = { id: 'C2', text: 'Sort with a merge sort you wrote yourself.', deduction: 4 };
const FREE = { id: 'C3', text: 'Free every block you allocate.', deduction: 1 };
const source = 'int main() {\n    return 0;\n}\n';
const PASS = JSON.stringify({ verdict: 'pass', evidence: [], reason: 'nothing allocated' });

const run = (answer: Parameters<typeof fakeModel>[0], constraints = [MERGE], timeoutMs = 2000) =>
  check(
    { statement, constraints, source },
    { modelOff: false, model: fakeModel(answer), timeoutMs },
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('output that breaks the schema becomes unsure', () => {
  const unsure = {
    constraintId: 'C2',
    verdict: 'unsure',
    evidence: [],
    decidedBy: 'guardrail',
    unsureCause: 'bad-schema',
  };

  it.each([
    ['text that is not JSON', 'Looks fine to me: pass.'],
    ['a JSON value that is not an object', '["pass"]'],
    [
      'a verdict outside pass, violation, unsure',
      JSON.stringify({ verdict: 'ok', evidence: [], reason: 'x' }),
    ],
    ['a missing verdict', JSON.stringify({ evidence: [], reason: 'x' })],
    [
      'evidence that is not a list',
      JSON.stringify({ verdict: 'pass', evidence: 'none', reason: 'x' }),
    ],
    [
      'an evidence line that is not a positive integer',
      JSON.stringify({
        verdict: 'violation',
        evidence: [{ line: '2', text: 'return 0;' }],
        reason: 'x',
      }),
    ],
    ['a reason that is not a string', JSON.stringify({ verdict: 'pass', evidence: [], reason: 3 })],
    [
      'a field the schema does not have, such as a deduction',
      JSON.stringify({ verdict: 'violation', evidence: [], reason: 'x', deduction: 4 }),
    ],
  ])('%s', async (_case, text) => {
    const result = await run(() => text);
    expect(result.verdicts).toEqual([unsure]);
  });

  it('logs the call, with the outcome bad-schema', async () => {
    const { calls } = await run(() => 'not json');
    expect(calls).toEqual([
      expect.objectContaining({ constraintId: 'C2', requestId: 'fake-1', outcome: 'bad-schema' }),
    ]);
  });
});

describe('no answer in time becomes unsure', () => {
  it('aborts the call after timeoutMs and answers unsure, cause timeout', async () => {
    const started = Date.now();
    const result = await run(never, [MERGE], 50);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.verdicts).toEqual([
      {
        constraintId: 'C2',
        verdict: 'unsure',
        evidence: [],
        decidedBy: 'guardrail',
        unsureCause: 'timeout',
      },
    ]);
    expect(result.calls).toEqual([
      expect.objectContaining({ constraintId: 'C2', outcome: 'timeout' }),
    ]);
  });

  it('gives the model the abort signal, so the request itself is cancelled', async () => {
    let signal: AbortSignal | undefined;
    await run(
      (_prompt, s) => {
        signal = s;
        return never(_prompt, s);
      },
      [MERGE],
      50,
    );
    expect(signal?.aborted).toBe(true);
  });
});

describe('a limit costs one pair, not the submission', () => {
  it('keeps the model verdict of the other constraint when one times out', async () => {
    const result = await run(
      (prompt, signal) => (prompt.includes(MERGE.text) ? never(prompt, signal) : PASS),
      [MERGE, FREE],
      50,
    );
    expect(result.verdicts).toEqual([
      expect.objectContaining({ constraintId: 'C2', verdict: 'unsure', unsureCause: 'timeout' }),
      {
        constraintId: 'C3',
        verdict: 'pass',
        evidence: [],
        reason: 'nothing allocated',
        decidedBy: 'model',
      },
    ]);
  });

  it('keeps the model verdict of the other constraint when one breaks the schema', async () => {
    const result = await run(
      (prompt) => (prompt.includes(MERGE.text) ? '{"verdict": "pass"' : PASS),
      [MERGE, FREE],
    );
    expect(result.verdicts.map((v) => [v.constraintId, v.verdict, v.unsureCause])).toEqual([
      ['C2', 'unsure', 'bad-schema'],
      ['C3', 'pass', undefined],
    ]);
  });
});

describe('the limits tests stay offline', () => {
  it('never calls fetch with a fake model', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await run(() => PASS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
