import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

const exec = promisify(execFile);
it('runs with no external network interface', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source = await readFile(
    new URL('../../../sandbox/attacks/network.cpp', import.meta.url),
    'utf8',
  );
  let inspected = false;
  const result = await judge({
    image,
    source,
    cases: [{ input: '', expectedOutput: 'blocked' }],
    cpuSeconds: 1,
    memoryMb: 256,
    onContainer: async (id, phase) => {
      if (phase !== 'test') return;
      const { stdout } = await exec('docker', [
        'inspect',
        '--format',
        '{{.HostConfig.NetworkMode}}',
        id,
      ]);
      expect(stdout.trim()).toBe('none');
      inspected = true;
    },
  });
  expect(inspected).toBe(true);
  expect(result.status).toBe('AC');
});
