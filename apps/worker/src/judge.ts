// The judge worker (D12): claims submissions, judges them in the sandbox, stores the results.
// It can start containers and refuses to start with a model key in its environment.
import { createDb } from '../../../packages/db/src/client.js';
import { JudgeQueue } from '../../../packages/db/src/job-queue.js';
import { judge } from '../../../packages/judge/src/index.js';
import { judgeConfig } from './judge-config.js';
import { judgeNext } from './judge-worker.js';
import { runLoop } from './run-loop.js';

const config = judgeConfig(process.env);
const handle = createDb(config.databaseUrl);
const queue = new JudgeQueue(handle.db);
const log = (line: string) => console.log(`${new Date().toISOString()} judge ${line}`);

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop.abort());

log('started');
await runLoop(
  () =>
    judgeNext({
      queue,
      judge,
      image: config.image,
      leaseMs: 60_000,
      heartbeatMs: 20_000,
      retryMs: 30_000,
      log,
    }),
  { idleMs: 1000, signal: stop.signal, log },
);
await handle.close();
log('stopped');
