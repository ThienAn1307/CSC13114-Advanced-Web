import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

it('stops a busy program on CPU time before the wall-clock limit', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source = await readFile(
    new URL('../../../sandbox/attacks/cpu.cpp', import.meta.url),
    'utf8',
  );
  const result = await judge({
    image,
    source,
    cases: [{ input: '', expectedOutput: '' }],
    cpuSeconds: 1,
    memoryMb: 256,
  });
  expect(result.status).toBe('TLE');
  expect(result.tests[0]?.wallTimedOut).toBe(false);
});
