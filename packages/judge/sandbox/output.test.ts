import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

it('stops a submission that exceeds one MiB of output', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source = await readFile(
    new URL('../../../sandbox/attacks/output.cpp', import.meta.url),
    'utf8',
  );
  const result = await judge({
    image,
    source,
    cases: [{ input: '', expectedOutput: '' }],
    cpuSeconds: 2,
    memoryMb: 256,
  });
  expect(result.status).toBe('RE');
  expect(result.tests[0]?.outputExceeded).toBe(true);
  expect(result.tests[0]?.wallTimedOut).toBe(false);
});
