import { expect, it } from 'vitest';
import { runLoop } from '../src/run-loop.js';

it('goes on at once after work, waits when idle, and stops after the current step', async () => {
  const stop = new AbortController();
  const steps = ['judged', 'idle', 'judged'];
  let calls = 0;
  await runLoop(
    () => {
      const step = steps[calls++]!;
      if (calls === steps.length) stop.abort();
      return Promise.resolve(step);
    },
    { idleMs: 5, signal: stop.signal, log: () => {} },
  );
  expect(calls).toBe(3);
});

it('stops at once while it waits', async () => {
  const stop = new AbortController();
  const done = runLoop(() => Promise.resolve('idle'), {
    idleMs: 60_000,
    signal: stop.signal,
    log: () => {},
  });
  setTimeout(() => stop.abort(), 20);
  await done;
});

it('survives a failing step, such as a lost database, and logs no detail of it', async () => {
  const stop = new AbortController();
  const lines: string[] = [];
  let calls = 0;
  await runLoop(
    () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('postgresql://user:password@host'));
      stop.abort();
      return Promise.resolve('idle');
    },
    { idleMs: 5, signal: stop.signal, log: (line) => lines.push(line) },
  );
  expect(calls).toBe(2);
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain('password');
});
