import { setTimeout as sleep } from 'node:timers/promises';

export interface LoopOptions {
  /** How long to wait before asking again when there was nothing to do. */
  idleMs: number;
  /** Aborted on SIGTERM: the current step finishes, and no new one starts. */
  signal: AbortSignal;
  log: (line: string) => void;
}

/** Repeats `step` until the signal is aborted. A step that fails is logged and tried again. */
export async function runLoop(step: () => Promise<string>, options: LoopOptions): Promise<void> {
  while (!options.signal.aborted) {
    let outcome: string;
    try {
      outcome = await step();
    } catch {
      // Fixed text: a driver's error may contain the connection string.
      options.log('step failed; trying again');
      outcome = 'idle';
    }
    if (outcome === 'idle') {
      await sleep(options.idleMs, undefined, { signal: options.signal }).catch(() => undefined);
    }
  }
}
