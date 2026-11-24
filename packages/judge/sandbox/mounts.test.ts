import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

const exec = promisify(execFile);
it('has no host binds, volumes or Docker socket during compilation or execution', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source = await readFile(
    new URL('../../../sandbox/attacks/mounts.cpp', import.meta.url),
    'utf8',
  );
  const phases: string[] = [];
  const result = await judge({
    image,
    source,
    cases: [{ input: '', expectedOutput: 'no socket' }],
    cpuSeconds: 2,
    memoryMb: 256,
    onContainer: async (id, phase) => {
      const mounts = await exec('docker', ['inspect', '--format', '{{json .Mounts}}', id]);
      const binds = await exec('docker', ['inspect', '--format', '{{json .HostConfig.Binds}}', id]);
      const entries = JSON.parse(mounts.stdout) as { Type: string }[] | null;
      expect(
        (entries ?? []).filter((entry) => entry.Type === 'bind' || entry.Type === 'volume'),
      ).toEqual([]);
      expect(JSON.parse(binds.stdout) as unknown).toBeNull();
      phases.push(phase);
    },
  });
  expect(phases).toEqual(['compile', 'test']);
  expect(result.status).toBe('AC');
});
