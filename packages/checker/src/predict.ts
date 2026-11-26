// Runs check() over a folder with the dev set's layout and writes the prediction file eval.mjs reads.
// It reads only problems/<id>/statement.md, problems/<id>/constraints.json and solutions/<id>/*.cpp,
// so it works on the lecturer's held-out set, which has no labels for us.

import { readdirSync, readFileSync, writeFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { check, type CheckOptions, type Constraint } from './check.ts';

export type PredictOptions = {
  data: string;
  out: string;
  /** Where to write the call log, one JSONL line per model call (D14). */
  calls?: string;
} & CheckOptions;

const sortedNames = (dir: string, keep: (entry: Dirent) => boolean) =>
  readdirSync(dir, { withFileTypes: true })
    .filter(keep)
    .map((entry) => entry.name)
    .sort();

export async function writePredictions({
  data,
  out,
  calls,
  ...options
}: PredictOptions): Promise<void> {
  const lines: string[] = [];
  const callLines: string[] = [];
  for (const problem of sortedNames(join(data, 'problems'), (e) => e.isDirectory())) {
    const folder = join(data, 'problems', problem);
    const statement = readFileSync(join(folder, 'statement.md'), 'utf8');
    const constraints = JSON.parse(
      readFileSync(join(folder, 'constraints.json'), 'utf8'),
    ) as Constraint[];
    const solutions = join(data, 'solutions', problem);
    for (const file of sortedNames(solutions, (e) => e.isFile() && e.name.endsWith('.cpp'))) {
      const source = readFileSync(join(solutions, file), 'utf8');
      const { verdicts, calls: made } = await check({ statement, constraints, source }, options);
      const solution = `${problem}/${file.slice(0, -'.cpp'.length)}`;
      for (const call of made) callLines.push(JSON.stringify({ solution, ...call }));
      for (const v of verdicts) {
        lines.push(
          JSON.stringify({
            solution,
            constraint: v.constraintId,
            verdict: v.verdict,
            evidence: v.evidence,
          }),
        );
      }
    }
  }
  const jsonl = (rows: string[]) => rows.map((row) => row + '\n').join('');
  writeFileSync(out, jsonl(lines));
  if (calls) writeFileSync(calls, jsonl(callLines));
}
