import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

const exec = promisify(execFile);
it('enforces the memory limit with swap included against an allocation that is read back', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source = await readFile(
    new URL('../../../sandbox/attacks/memory.cpp', import.meta.url),
    'utf8',
  );
  let inspected = false;
  const result = await judge({
    image,
    source,
    cases: [{ input: '', expectedOutput: '' }],
    cpuSeconds: 2,
    memoryMb: 256,
    onContainer: async (id, phase) => {
      if (phase !== 'test') return;
      const { stdout } = await exec('docker', [
        'inspect',
        '--format',
        '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}',
        id,
      ]);
      expect(stdout.trim()).toBe('268435456 268435456');
      inspected = true;
    },
  });
  expect(inspected).toBe(true);
  expect(['MLE', 'RE']).toContain(result.status);
  expect(result.tests[0]?.wallTimedOut).toBe(false);
});
