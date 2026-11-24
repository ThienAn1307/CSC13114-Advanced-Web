// The check worker (D12): hard rules, then the model, on Accepted submissions only. It holds the
// model key and has no access to Docker. Run one: the client's rate limit is per process (D8).
import { geminiModel } from '../../../packages/checker/src/gemini.ts';
import { createDb } from '../../../packages/db/src/client.js';
import { CheckQueue } from '../../../packages/db/src/job-queue.js';
import { ModelCallLog } from '../../../packages/db/src/model-calls.js';
import { checkConfig } from './check-config.js';
import { checkNext } from './check-worker.js';
import { runLoop } from './run-loop.js';

const config = checkConfig(process.env);
const handle = createDb(config.databaseUrl);
const queue = new CheckQueue(handle.db);
const calls = new ModelCallLog(handle.db);
const model = config.gemini && geminiModel(config.gemini);
const log = (line: string) => console.log(`${new Date().toISOString()} check ${line}`);

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop.abort());

log(`started, ${model ? model.name : 'model off'}`);
await runLoop(
  () =>
    checkNext({
      queue,
      calls,
      model,
      timeoutMs: 60_000, // as the checker command: room for the rate wait and two retries
      maxCallsPerLab: config.maxCallsPerLab,
      leaseMs: 60_000,
      heartbeatMs: 20_000,
      retryMs: 30_000,
      log,
    }),
  { idleMs: 1000, signal: stop.signal, log },
);
await handle.close();
log('stopped');
