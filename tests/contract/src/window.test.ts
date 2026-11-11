import { describe, expect, it } from 'vitest';
import { SEED_WINDOWS } from './hooks.js';
import {
  expectAccepted,
  expectProblem,
  isReplay,
  json,
  newKey,
  submit,
  useHarness,
} from './helpers.js';

describe('sections 4.6 and 4.7: deadline, resubmission, queue failure', () => {
  const h = useHarness();
  const lab = () => h().seed.labs.class1Open;
  const openedAt = () => new Date(h().seededAt.getTime() - SEED_WINDOWS.openLabOpenedBeforeMs);
  const dueAt = () => new Date(h().seededAt.getTime() + SEED_WINDOWS.openLabDueAfterMs);

  it('4.6: a lab that has not opened yet gets 409 lab-not-open', async () => {
    const res = await submit(h(), { labId: h().seed.labs.class1NotOpen });
    expectProblem(res, 'lab-not-open');
  });

  it('4.6: a lab whose deadline has passed gets 409 lab-closed', async () => {
    const res = await submit(h(), { labId: h().seed.labs.class1Closed });
    expectProblem(res, 'lab-closed');
  });

  it('4.6: a request received 1 ms before the lab opens gets 409 lab-not-open', async () => {
    h().clock.set(new Date(openedAt().getTime() - 1));
    const res = await submit(h(), { labId: lab() });
    expectProblem(res, 'lab-not-open');
  });

  it('4.6: a request received at the moment the lab opens is accepted', async () => {
    h().clock.set(openedAt());
    const res = await submit(h(), { labId: lab() });
    expect(expectAccepted(res, lab()).receivedAt).toBe(openedAt().toISOString());
  });

  it('4.6: a request received 1 ms before the deadline is accepted', async () => {
    const at = new Date(dueAt().getTime() - 1);
    h().clock.set(at);
    const res = await submit(h(), { labId: lab() });
    expect(expectAccepted(res, lab()).receivedAt).toBe(at.toISOString());
  });

  it('4.6: a request received at the deadline gets 409 lab-closed', async () => {
    h().clock.set(dueAt());
    const res = await submit(h(), { labId: lab() });
    expectProblem(res, 'lab-closed');
  });

  it('4.6: a student may submit many times before the deadline; each new key creates a new submission', async () => {
    const first = await submit(h(), {
      labId: lab(),
      key: newKey(),
      body: json({ source: 'int main() { return 1; }' }),
    });
    const second = await submit(h(), {
      labId: lab(),
      key: newKey(),
      body: json({ source: 'int main() { return 1; }' }),
    });
    const a = expectAccepted(first, lab());
    const b = expectAccepted(second, lab());
    expect(b.id).not.toBe(a.id);
    expect(h().queue.calls).toEqual([a.id, b.id]);
  });

  it('4.6: a retry after the deadline with the same key and body replays the original 202', async () => {
    // The contract's 21:59 / 22:01 case: both requests within 24 hours, so the key has not expired.
    h().clock.set(new Date(dueAt().getTime() - 60_000));
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key });
    const original = expectAccepted(first, lab());
    h().clock.set(new Date(dueAt().getTime() + 60_000));
    const retry = await submit(h(), { labId: lab(), key });
    expect(retry.status).toBe(202);
    expect(isReplay(retry)).toBe(true);
    expect(retry.body).toEqual(original);
  });

  it('4.6: a retry after the deadline whose first attempt failed gets 409 lab-closed', async () => {
    // The contract's 21:59 / 22:01 case: both requests within 24 hours, so the key has not expired.
    h().clock.set(new Date(dueAt().getTime() - 60_000));
    const key = newKey();
    const broken = await submit(h(), { labId: lab(), key, body: json({ source: '' }) });
    expectProblem(broken, 'validation-failed');
    h().clock.set(new Date(dueAt().getTime() + 60_000));
    const retry = await submit(h(), { labId: lab(), key });
    expectProblem(retry, 'lab-closed');
  });

  it('4.7: when putting the submission on the queue fails, the client still gets 202 with status queued', async () => {
    h().queue.failure = new Error('queue is down');
    const res = await submit(h(), { labId: lab() });
    const receipt = expectAccepted(res, lab());
    expect(receipt.status).toBe('queued');
    expect(h().queue.calls).toEqual([receipt.id]);
  });

  it('4.7: after a queue failure, a retry with the same key replays the stored submission', async () => {
    h().queue.failure = new Error('queue is down');
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key });
    const original = expectAccepted(first, lab());
    h().queue.failure = undefined;
    const retry = await submit(h(), { labId: lab(), key });
    expect(isReplay(retry)).toBe(true);
    expect(retry.body).toEqual(original);
  });
});
