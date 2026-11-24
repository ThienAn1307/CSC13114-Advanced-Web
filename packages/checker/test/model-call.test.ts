// PA#3 criteria 3 and 4, D14 and D15: what reaches the model, what comes back, and what is logged.
// Fake model only.

import { describe, expect, it } from 'vitest';
import { check, type CheckInput } from '../src/check.ts';
import { fakeModel, never } from './fake-model.ts';

const code = (...lines: string[]) => lines.join('\n') + '\n';
const statement =
  '# Dynamic array\n\nRead integers until the end of input and print them reversed.\n';
const BAN = { id: 'C1', text: 'Do not use these containers: `std::vector`.', deduction: 4 };
const GROW = {
  id: 'C2',
  text: 'Grow a block you allocate yourself when it is full.',
  deduction: 3,
};
const FREE = { id: 'C3', text: 'Free every block you allocate.', deduction: 1 };
const identity = {
  name: 'Nguyễn Văn An',
  email: 'an.nguyen@example.edu.vn',
  studentId: '23129999',
};
const source = code(
  '#include <cstdio>',
  '#include <cstdlib>',
  'int main() {',
  '    int* p = (int*)malloc(4 * sizeof(int)); // first block',
  '    puts("by Nguyễn Văn An, an.nguyen@example.edu.vn, 23129999");',
  '    puts("Nguyen Van An");',
  '    free(p);',
  '}',
);
const answer = (verdict: string, evidence: { line: number; text: string }[] = []) =>
  JSON.stringify({ verdict, evidence, reason: 'because' });
const timeoutMs = 2000;

const ask = async (reply: string, input: Partial<CheckInput> = {}) => {
  const model = fakeModel(() => reply);
  const result = await check(
    { statement, constraints: [GROW], source, identity, ...input },
    { modelOff: false, model, timeoutMs },
  );
  return { ...result, prompts: model.prompts };
};

describe('what the model is asked', () => {
  it('never sends a constraint the hard rules decided, and the call log shows only the model pairs', async () => {
    const model = fakeModel(() => answer('pass'));
    const { verdicts, calls } = await check(
      { statement, constraints: [BAN, GROW, FREE], source, identity },
      { modelOff: false, model, timeoutMs },
    );
    expect(verdicts.map((v) => [v.constraintId, v.decidedBy])).toEqual([
      ['C1', 'hard-rule'],
      ['C2', 'model'],
      ['C3', 'model'],
    ]);
    expect(calls.map((c) => c.constraintId)).toEqual(['C2', 'C3']);
    expect(model.prompts.some((p) => p.includes(BAN.text))).toBe(false);
  });

  it('holds the statement, that one constraint and the code, but no comment and no other constraint', async () => {
    const model = fakeModel(() => answer('pass'));
    await check(
      { statement, constraints: [GROW, FREE], source, identity },
      { modelOff: false, model, timeoutMs },
    );
    const [first] = model.prompts;
    expect(first).toContain('Read integers until the end of input and print them reversed.');
    expect(first).toContain(GROW.text);
    expect(first).not.toContain(FREE.text);
    expect(first).toContain('free(p);');
    expect(first).not.toContain('first block');
  });

  it("replaces the student's name, email and student id, with and without diacritics", async () => {
    const { prompts } = await ask(answer('pass'));
    const [prompt] = prompts;
    for (const secret of ['Nguyễn Văn An', 'Nguyen Van An', identity.email, identity.studentId]) {
      expect(prompt).not.toContain(secret);
    }
    expect(prompt).toContain('<STUDENT_NAME>');
    expect(prompt).toContain('<STUDENT_EMAIL>');
    expect(prompt).toContain('<STUDENT_ID>');
  });

  // The first real run (eval/runs/2026-11-23-gemini-3.1-flash-lite) deducted twice for memory that a
  // library container allocated for itself, under a constraint that says a program allocating nothing
  // passes. These two rules are general; neither names a problem.
  it('tells the model to apply the cases the constraint text itself says pass or fail', async () => {
    const { prompts } = await ask(answer('pass'));
    expect(prompts[0]).toContain(
      'Apply the constraint text exactly, including every case it says passes or does not satisfy it.',
    );
  });

  it('tells the model that memory a library type manages for itself is not allocated by the student', async () => {
    const { prompts } = await ask(answer('pass'));
    expect(prompts[0]).toContain(
      'Memory that a standard library type allocates and frees for itself (std::vector, std::string and the like) is not memory the student allocated or must free.',
    );
  });

  it('keeps every line where it was, so line N of the prompt is line N of the submission (D15)', async () => {
    const { prompts } = await ask(answer('pass'));
    const promptLines = prompts[0]!.split('\n');
    expect(promptLines).toContain('7|     free(p);');
    expect(promptLines).toContain(
      `4|     int* p = (int*)malloc(4 * sizeof(int));${' '.repeat(' // first block'.length)}`,
    );
  });
});

describe('the evidence the model gives (D15)', () => {
  it('is written with the original line when its text matches the line in the prompt', async () => {
    const { verdicts } = await ask(
      answer('violation', [{ line: 4, text: 'int* p = (int*)malloc(4 * sizeof(int));' }]),
    );
    expect(verdicts).toEqual([
      {
        constraintId: 'C2',
        verdict: 'violation',
        evidence: [{ line: 4, text: '    int* p = (int*)malloc(4 * sizeof(int)); // first block' }],
        reason: 'because',
        decidedBy: 'model',
      },
    ]);
  });

  it('matches a line whose identity was replaced, as the prompt shows it', async () => {
    const { verdicts } = await ask(
      answer('violation', [
        { line: 5, text: 'puts("by <STUDENT_NAME>, <STUDENT_EMAIL>, <STUDENT_ID>");' },
      ]),
    );
    expect(verdicts[0]).toMatchObject({ verdict: 'violation', evidence: [{ line: 5 }] });
  });

  it.each([
    ['a text that is not on that line', [{ line: 7, text: 'delete[] p;' }]],
    ['a line past the end of the code', [{ line: 40, text: 'free(p);' }]],
    [
      'the original text of a line whose comment the prompt left out',
      [{ line: 4, text: 'int* p = (int*)malloc(4 * sizeof(int)); // first block' }],
    ],
    ['a violation with no evidence at all', []],
  ])('makes the pair unsure when it gives %s', async (_case, evidence) => {
    const { verdicts, calls } = await ask(answer('violation', evidence));
    expect(verdicts).toEqual([
      {
        constraintId: 'C2',
        verdict: 'unsure',
        evidence: [],
        decidedBy: 'guardrail',
        unsureCause: 'evidence-mismatch',
      },
    ]);
    expect(calls[0]).toMatchObject({ outcome: 'evidence-mismatch' });
  });

  it("keeps the model's own unsure, with its reason and cause model-unsure", async () => {
    const { verdicts } = await ask(answer('unsure'));
    expect(verdicts).toEqual([
      {
        constraintId: 'C2',
        verdict: 'unsure',
        evidence: [],
        reason: 'because',
        decidedBy: 'model',
        unsureCause: 'model-unsure',
      },
    ]);
  });
});

describe('the call log', () => {
  it('has one row per call with the request id, model, tokens, time and outcome', async () => {
    const { calls, prompts } = await ask(answer('pass'));
    expect(calls).toEqual([
      {
        constraintId: 'C2',
        requestId: 'fake-1',
        model: 'fake-model',
        tokensIn: 0,
        tokensOut: 0,
        ms: expect.any(Number) as unknown,
        outcome: 'answered',
        prompt: prompts[0],
      },
    ]);
  });

  // PA#3 criterion 4: "the prompts in your call log show" that only the statement, the constraint and
  // the code without comments and identity were sent.
  it('keeps the prompt that was sent, without comments or identity', async () => {
    const { calls } = await ask(answer('pass'));
    const prompt = calls[0]?.prompt ?? '';
    expect(prompt).toContain(GROW.text);
    expect(prompt).not.toContain('first block');
    expect(prompt).not.toContain(identity.name);
    expect(prompt).not.toContain(identity.email);
    expect(prompt).not.toContain(identity.studentId);
  });

  it('keeps the prompt of a call that failed or ran out of time', async () => {
    const failing = fakeModel(() => Promise.reject(new Error('HTTP 503')));
    const slow = fakeModel(never);
    const ask2 = (model: typeof slow, limit: number) =>
      check(
        { statement, constraints: [GROW], source, identity },
        { modelOff: false, model, timeoutMs: limit },
      );
    expect((await ask2(failing, 2000)).calls).toMatchObject([
      { outcome: 'model-error', prompt: failing.prompts[0] },
    ]);
    expect((await ask2(slow, 50)).calls).toMatchObject([
      { outcome: 'timeout', prompt: slow.prompts[0] },
    ]);
  });
});
