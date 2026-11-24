import type { Claim, JudgeOutcome, JudgeQueue } from '../../../packages/db/src/job-queue.js';
import type { JudgeRequest, JudgeResult } from '../../../packages/judge/src/index.js';

export interface JudgeWorkerOptions {
  queue: JudgeQueue;
  judge: (request: JudgeRequest) => Promise<JudgeResult>;
  image: string;
  leaseMs: number;
  /** How often the lease is renewed while judging; well below `leaseMs`. */
  heartbeatMs: number;
  /** How long a submission waits after an error before the next try. */
  retryMs: number;
  log: (line: string) => void;
}

export type JudgeStep = 'idle' | 'judged' | 'retry' | 'failed' | 'lost';

function toOutcome(result: JudgeResult): JudgeOutcome {
  return {
    status: result.status,
    tests: result.tests.map(({ status }) => {
      if (status === 'CE') throw new Error('A test cannot end as a compile error.');
      return status;
    }),
  };
}

/** Claims one submission, judges it in the sandbox and stores the result (D11, D12). */
export async function judgeNext(options: JudgeWorkerOptions): Promise<JudgeStep> {
  const { queue, log } = options;
  const claim = await queue.claim(options.leaseMs);
  if (!claim) return 'idle';

  const task = await queue.task(claim.submissionId);
  if (task.cases.length === 0) return giveUp(options, claim, 'lab-has-no-tests');

  // Judging can take minutes (50 tests), longer than any lease that also finds a dead worker soon.
  const heartbeat = setInterval(() => {
    queue.renew(claim, options.leaseMs).catch(() => log(`${claim.submissionId} renew failed`));
  }, options.heartbeatMs);
  let outcome: JudgeOutcome;
  try {
    outcome = toOutcome(await options.judge({ image: options.image, ...task }));
  } catch {
    // The error text may quote the student's code, so only the cause is kept.
    return await giveUp(options, claim, 'sandbox-error');
  } finally {
    clearInterval(heartbeat);
  }

  const stored = await queue.complete(claim, outcome);
  log(`${claim.submissionId} ${stored ? outcome.status : 'lost'}`);
  return stored ? 'judged' : 'lost';
}

async function giveUp(
  options: JudgeWorkerOptions,
  claim: Claim,
  cause: string,
): Promise<JudgeStep> {
  const result = await options.queue.giveUp(claim, cause, options.retryMs);
  options.log(`${claim.submissionId} ${cause}, attempt ${claim.attempts}: ${result}`);
  return result;
}
