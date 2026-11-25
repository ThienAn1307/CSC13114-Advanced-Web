import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

const exec = promisify(execFile);
it('runs as a non-root user without privileged capabilities', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source = await readFile(
    new URL('../../../sandbox/attacks/user.cpp', import.meta.url),
    'utf8',
  );
  let inspected = false;
  const result = await judge({
    image,
    source,
    cases: [{ input: '', expectedOutput: 'non-root' }],
    cpuSeconds: 1,
    memoryMb: 256,
    onContainer: async (id, phase) => {
      if (phase !== 'test') return;
      const { stdout } = await exec('docker', [
        'inspect',
        '--format',
        '{{.Config.User}} {{.HostConfig.Privileged}} {{json .HostConfig.CapDrop}}',
        id,
      ]);
      expect(stdout.trim()).toBe('65534:65534 false ["ALL"]');
      inspected = true;
    },
  });
  expect(inspected).toBe(true);
  expect(result.status).toBe('AC');
});
