import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { check } from '../src/check.ts';

const code = (...lines: string[]) => lines.join('\n') + '\n';
const statement = '# Sorting\n\nRead `n` integers and print them in non-decreasing order.\n';
const BAN = { id: 'C1', text: 'Do not call a library sort: `std::sort`, `qsort`.', deduction: 3 };
const SEMANTIC = { id: 'C2', text: 'Sort with a merge sort you wrote yourself.', deduction: 4 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('check with the model off (MODEL_OFF=1)', () => {
  it('decides a ban list by the hard rules and leaves a semantic constraint unsure', async () => {
    const source = code('#include <algorithm>', 'int a[3];', 'int main() { std::sort(a, a + 3); }');
    const result = await check(
      { statement, constraints: [BAN, SEMANTIC], source },
      { modelOff: true },
    );
    expect(result).toEqual({
      verdicts: [
        {
          constraintId: 'C1',
          verdict: 'violation',
          evidence: [{ line: 3, text: 'int main() { std::sort(a, a + 3); }' }],
          reason: expect.stringContaining('std::sort') as unknown,
          decidedBy: 'hard-rule',
        },
        {
          constraintId: 'C2',
          verdict: 'unsure',
          evidence: [],
          decidedBy: 'guardrail',
          unsureCause: 'model-off',
        },
      ],
      calls: [],
    });
  });

  it('answers pass, decided by the hard rules, for code that keeps the ban list', async () => {
    const source = code('int main() { int x = 1, y = 2; if (x > y) return 1; }');
    const { verdicts } = await check({ statement, constraints: [BAN], source }, { modelOff: true });
    expect(verdicts).toEqual([
      { constraintId: 'C1', verdict: 'pass', evidence: [], decidedBy: 'hard-rule' },
    ]);
  });

  it('leaves a ban list it cannot read unsure, as it does a semantic constraint', async () => {
    const unreadable = { id: 'C3', text: 'Do not use `printf("%d")`.', deduction: 1 };
    const { verdicts } = await check(
      { statement, constraints: [unreadable], source: code('int main() {}') },
      { modelOff: true },
    );
    expect(verdicts).toEqual([
      {
        constraintId: 'C3',
        verdict: 'unsure',
        evidence: [],
        decidedBy: 'guardrail',
        unsureCause: 'model-off',
      },
    ]);
  });

  it('leaves a ban list unsure when `##` in a macro could spell a banned name', async () => {
    const source = code(
      '#include <algorithm>',
      '#define J(a, b) a##b',
      'int a[3];',
      'int main() { std::J(so, rt)(a, a + 3); }',
    );
    const { verdicts } = await check({ statement, constraints: [BAN], source }, { modelOff: true });
    expect(verdicts).toEqual([
      {
        constraintId: 'C1',
        verdict: 'unsure',
        evidence: [],
        decidedBy: 'guardrail',
        unsureCause: 'model-off',
      },
    ]);
  });

  it('gives exactly one verdict per constraint, in the order of the constraints', async () => {
    const { verdicts } = await check(
      { statement, constraints: [SEMANTIC, BAN], source: code('int main() {}') },
      { modelOff: true },
    );
    expect(verdicts.map((v) => v.constraintId)).toEqual(['C2', 'C1']);
  });

  it('opens no network connection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const connectSpy = vi.spyOn(net.Socket.prototype, 'connect');
    await check(
      { statement, constraints: [BAN, SEMANTIC], source: code('int main() {}') },
      { modelOff: true },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });
});
