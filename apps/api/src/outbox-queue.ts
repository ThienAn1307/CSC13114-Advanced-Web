import type { SubmissionQueue } from './submissions/submission-data.js';

/**
 * PA#2 has no judge worker and no Redis (decisions.md, "Out of scope for PA#2"), so nothing
 * consumes a queue yet. Every submission is already stored as `queued`, which is the outbox
 * (D6, contract section 4.7): the sweep added with the BullMQ queue in PA#3 enqueues these rows
 * through `listQueuedSubmissions`. Enqueueing here therefore does nothing and never fails.
 */
export const outboxOnlyQueue: SubmissionQueue = {
  enqueue: () => Promise.resolve(),
};
