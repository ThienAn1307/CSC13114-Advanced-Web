import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writePredictions } from '../src/predict.ts';
import { fakeModel } from './fake-model.ts';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const cli = join(repoRoot, 'packages', 'checker', 'src', 'cli.ts');
const devSet = join(repoRoot, 'eval', 'dev');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runNode(args: string[], env: Record<string, string | undefined>): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      // A variable set to undefined is left out, so a test can run the command without it.
      {
        env: Object.fromEntries(
          Object.entries({ ...process.env, ...env }).filter(([, v]) => v !== undefined),
        ),
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

const readJsonl = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);

let work: string;

/** A dataset with only what the lecturer's held-out set is sure to have: no tests, no labels. */
function smallDataset(): string {
  const data = join(work, 'data');
  mkdirSync(join(data, 'problems', 'sorting'), { recursive: true });
  mkdirSync(join(data, 'solutions', 'sorting'), { recursive: true });
  writeFileSync(
    join(data, 'problems', 'sorting', 'statement.md'),
    '# Sorting\n\nPrint the numbers in order.\n',
  );
  writeFileSync(
    join(data, 'problems', 'sorting', 'constraints.json'),
    JSON.stringify([
      { id: 'C1', text: 'Do not call a library sort: `std::sort`, `qsort`.', deduction: 3 },
      { id: 'C2', text: 'Sort with a merge sort you wrote yourself.', deduction: 4 },
    ]),
  );
  writeFileSync(
    join(data, 'solutions', 'sorting', 's01.cpp'),
    '#include <algorithm>\nint a[3];\nint main() {\n    std::sort(a, a + 3);\n}\n',
  );
  writeFileSync(
    join(data, 'solutions', 'sorting', 's02.cpp'),
    '// std::sort is banned here\nint main() { return 0; }\n',
  );
  return data;
}

const smallExpected = [
  {
    solution: 'sorting/s01',
    constraint: 'C1',
    verdict: 'violation',
    evidence: [{ line: 4, text: '    std::sort(a, a + 3);' }],
  },
  { solution: 'sorting/s01', constraint: 'C2', verdict: 'unsure', evidence: [] },
  { solution: 'sorting/s02', constraint: 'C1', verdict: 'pass', evidence: [] },
  { solution: 'sorting/s02', constraint: 'C2', verdict: 'unsure', evidence: [] },
];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'leetkob-checker-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(work, { recursive: true, force: true });
});

describe('writePredictions with the model off', () => {
  it('writes one line per (solution, constraint) from statement.md and constraints.json alone', async () => {
    const out = join(work, 'predictions.jsonl');
    await writePredictions({ data: smallDataset(), out, modelOff: true });
    expect(readJsonl(out)).toEqual(smallExpected);
  });

  it('opens no network connection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const connectSpy = vi.spyOn(net.Socket.prototype, 'connect');
    await writePredictions({ data: smallDataset(), out: join(work, 'p.jsonl'), modelOff: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });
});

describe('the checker command', () => {
  it('runs with MODEL_OFF=1 on plain Node and writes the predictions', async () => {
    const out = join(work, 'predictions.jsonl');
    const run = await runNode([cli, '--data', smallDataset(), '--out', out], { MODEL_OFF: '1' });
    expect(run.code, run.stderr).toBe(0);
    expect(readJsonl(out)).toEqual(smallExpected);
  });

  it('prints its usage and exits 2 when --data or --out is missing', async () => {
    const run = await runNode([cli, '--data', smallDataset()], { MODEL_OFF: '1' });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--out');
  });

  it('exits 2 without MODEL_OFF=1 when GEMINI_API_KEY is not set, before any call', async () => {
    const out = join(work, 'predictions.jsonl');
    const run = await runNode([cli, '--data', smallDataset(), '--out', out], {
      MODEL_OFF: undefined,
      GEMINI_API_KEY: undefined,
    });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('GEMINI_API_KEY');
  });
});

describe('the checker command, given a GEMINI_API_KEY with white space or control characters', () => {
  // Ban lists only, so no model call is ever made, whatever the command does with the key.
  const runWithKey = (key: string) => {
    const data = smallDataset();
    writeFileSync(
      join(data, 'problems', 'sorting', 'constraints.json'),
      JSON.stringify([
        { id: 'C1', text: 'Do not call a library sort: `std::sort`, `qsort`.', deduction: 3 },
      ]),
    );
    return runNode([cli, '--data', data, '--out', join(work, 'p.jsonl')], {
      MODEL_OFF: undefined,
      GEMINI_API_KEY: key,
    });
  };

  it.each([
    ['a line break', 'fakekeyone\nfakekeytwo'],
    ['a control character', 'fakekeyone\u0001fakekeytwo'],
    ['a letter outside ASCII', 'fakekeyone\u1ec5fakekeytwo'],
  ])('exits 2 on %s inside the key, and never prints the key', async (_case, key) => {
    const run = await runWithKey(key);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('GEMINI_API_KEY');
    expect(run.stdout + run.stderr).not.toContain('fakekey');
  });

  it('treats a key of white space only as not set', async () => {
    const run = await runWithKey(' \r\n');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('GEMINI_API_KEY is not set');
  });

  it('accepts a key that ends with a line break, as a pasted key often does', async () => {
    const run = await runWithKey('fakekeyone\r\n');
    expect(run.code, run.stderr).toBe(0);
  });
});

describe('writePredictions with a model', () => {
  const PASS = JSON.stringify({ verdict: 'pass', evidence: [], reason: 'merge sort' });

  it('asks the model for the semantic pairs and writes their verdicts', async () => {
    const out = join(work, 'predictions.jsonl');
    await writePredictions({
      data: smallDataset(),
      out,
      modelOff: false,
      model: fakeModel(() => PASS),
      timeoutMs: 2000,
    });
    expect(readJsonl(out)).toEqual(
      smallExpected.map((line) => (line.constraint === 'C2' ? { ...line, verdict: 'pass' } : line)),
    );
  });

  it('writes the call log, one line per model call with its solution (PA#3 criterion 4)', async () => {
    const calls = join(work, 'calls.jsonl');
    await writePredictions({
      data: smallDataset(),
      out: join(work, 'p.jsonl'),
      calls,
      modelOff: false,
      model: fakeModel(() => PASS),
      timeoutMs: 2000,
    });
    const row = {
      constraintId: 'C2',
      model: 'fake-model',
      tokensIn: 0,
      tokensOut: 0,
      ms: expect.any(Number) as unknown,
      outcome: 'answered',
      // The prompt that was sent, so a reader can check what reached the model (PA#3 criterion 4).
      prompt: expect.stringContaining('Sort with a merge sort you wrote yourself.') as unknown,
    };
    expect(readJsonl(calls)).toEqual([
      { solution: 'sorting/s01', requestId: 'fake-1', ...row },
      { solution: 'sorting/s02', requestId: 'fake-2', ...row },
    ]);
  });
});

describe('the dev set, with the model off', () => {
  it('gives eval.mjs a valid file: exit 0 or 1, no wrongful deduction, every ban-list pair decided', async () => {
    const predictions = join(work, 'dev.jsonl');
    const summary = join(work, 'summary.json');
    await writePredictions({ data: devSet, out: predictions, modelOff: true });
    const run = await runNode(
      [join(devSet, 'eval.mjs'), '--data', devSet, '--predictions', predictions, '--json', summary],
      {},
    );
    expect([0, 1], run.stdout + run.stderr).toContain(run.code);
    const result = JSON.parse(readFileSync(summary, 'utf8')) as {
      wrongful: number;
      unsure: number;
      pairs: number;
    };
    // 102 pairs in the dev set; 55 are ban-list pairs, so only the 47 semantic ones are unsure.
    expect(result).toMatchObject({ pairs: 102, wrongful: 0, unsure: 47 });
  });
});
