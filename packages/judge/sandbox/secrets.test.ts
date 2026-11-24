import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

const exec = promisify(execFile);
it('does not pass host environment values or expose model keys as files or includes', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source = await readFile(
    new URL('../../../sandbox/attacks/secrets.cpp', import.meta.url),
    'utf8',
  );
  const previous = process.env.LEETKOB_TEST_SENTINEL;
  process.env.LEETKOB_TEST_SENTINEL = 'non-secret-marker';
  const phases: string[] = [];
  try {
    const result = await judge({
      image,
      source,
      cases: [{ input: '', expectedOutput: 'no secrets' }],
      cpuSeconds: 1,
      memoryMb: 256,
      onContainer: async (id, phase) => {
        const { stdout } = await exec('docker', [
          'inspect',
          '--format',
          '{{json .Config.Env}}',
          id,
        ]);
        const names = (JSON.parse(stdout) as string[]).map((value) => value.split('=')[0]);
        expect(names).not.toContain('GEMINI_API_KEY');
        expect(names).not.toContain('GOOGLE_API_KEY');
        expect(names).not.toContain('MODEL_API_KEY');
        expect(names).not.toContain('LEETKOB_TEST_SENTINEL');
        phases.push(phase);
      },
    });
    expect(phases).toEqual(['compile', 'test']);
    expect(result.status).toBe('AC');
  } finally {
    if (previous === undefined) delete process.env.LEETKOB_TEST_SENTINEL;
    else process.env.LEETKOB_TEST_SENTINEL = previous;
  }
});
