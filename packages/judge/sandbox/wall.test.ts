import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

const exec = promisify(execFile);
it('kills the whole container when a sleeping program and its child exceed wall time', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source = await readFile(
    new URL('../../../sandbox/attacks/wall.cpp', import.meta.url),
    'utf8',
  );
  let testContainer = '';
  const result = await judge({
    image,
    source,
    cases: [{ input: '', expectedOutput: '' }],
    cpuSeconds: 1,
    memoryMb: 256,
    onContainer: (id, phase) => {
      if (phase === 'test') testContainer = id;
    },
  });
  expect(result.status).toBe('TLE');
  expect(result.tests[0]?.wallTimedOut).toBe(true);
  expect(testContainer).toMatch(/^[0-9a-f]{64}$/);
  await expect(exec('docker', ['inspect', testContainer])).rejects.toThrow();
});
