import { check } from '../../../packages/checker/src/check.ts';
import type { Constraint, Verdict } from '../../../packages/checker/src/check.ts';
import type { Model } from '../../../packages/checker/src/model.ts';
import type { CheckQueue, CheckTask, Claim } from '../../../packages/db/src/job-queue.js';
import type { ModelCallLog } from '../../../packages/db/src/model-calls.js';

export interface CheckWorkerOptions {
  queue: CheckQueue;
  calls: ModelCallLog;
  /** Null with the model off: hard rules only. */
  model: Model | null;
  timeoutMs: number;
  maxCallsPerLab: number;
  leaseMs: number;
  /** How often the lease is renewed while checking; well below `leaseMs`. */
  heartbeatMs: number;
  /** How long a job waits after an error before the next try. */
  retryMs: number;
  log: (line: string) => void;
}

export type CheckStep = 'idle' | 'checked' | 'retry' | 'failed' | 'lost';

/** A university email starts with the student id; `users` has no column for it. */
function identityOf({ name, email }: CheckTask['student']) {
  const studentId = /^(\d+)@/.exec(email)?.[1];
  return { name, email, ...(studentId ? { studentId } : {}) };
}

/** One constraint: the hard rules, else one model call, logged and counted against the lab's cap. */
async function checkOne(
  options: CheckWorkerOptions,
  claim: Claim,
  task: CheckTask,
  constraint: Constraint,
): Promise<Verdict> {
  const { calls, model } = options;
  const input = {
    statement: task.statement,
    constraints: [constraint],
    source: task.source,
    identity: identityOf(task.student),
  };
  if (!model) return (await check(input, { modelOff: true })).verdicts[0]!;

  let callId: string | null = null;
  let overCap = false;
  const counted: Model = {
    name: model.name,
    async complete(request) {
      callId = await calls.start(
        {
          submissionId: claim.submissionId,
          labId: task.labId,
          constraintId: constraint.id,
          attempt: claim.attempts,
          model: model.name,
          prompt: request.prompt,
        },
        options.maxCallsPerLab,
      );
      if (callId === null) {
        overCap = true;
        throw new Error('The lab has used its model calls.');
      }
      return model.complete(request);
    },
  };
  const result = await check(input, {
    modelOff: false,
    model: counted,
    timeoutMs: options.timeoutMs,
  });
  const [call] = result.calls;
  if (call && callId !== null) await calls.finish(callId, call);
  const verdict = result.verdicts[0]!;
  // Theo FAQ-09: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-09
  return overCap ? { ...verdict, unsureCause: 'cost-cap' } : verdict;
}

/** Claims one Accepted submission, checks it and stores the verdicts in the TA's queue (D12, D18). */
export async function checkNext(options: CheckWorkerOptions): Promise<CheckStep> {
  const { queue, log } = options;
  const claim = await queue.claim(options.leaseMs);
  if (!claim) return 'idle';

  const heartbeat = setInterval(() => {
    queue.renew(claim, options.leaseMs).catch(() => log(`${claim.submissionId} renew failed`));
  }, options.heartbeatMs);
  try {
    const task = await queue.task(claim.submissionId);
    const verdicts: Verdict[] = [];
    for (const constraint of task.constraints) {
      verdicts.push(await checkOne(options, claim, task, constraint));
    }
    const stored = await queue.complete(claim, verdicts);
    log(`${claim.submissionId} ${stored ? `${verdicts.length} verdicts` : 'lost'}`);
    return stored ? 'checked' : 'lost';
  } catch {
    // The error text may quote the student's code, so only the cause is kept.
    const result = await queue.giveUp(claim, 'check-error', options.retryMs);
    log(`${claim.submissionId} check-error, attempt ${claim.attempts}: ${result}`);
    return result;
  } finally {
    clearInterval(heartbeat);
  }
}
