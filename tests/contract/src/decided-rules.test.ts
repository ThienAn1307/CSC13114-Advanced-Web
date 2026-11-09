import { describe, expect, it } from 'vitest';
import { DAY_MS, SEED_WINDOWS } from './hooks.js';
import { expectAccepted, isReplay, newKey, submit, useHarness } from './helpers.js';

/**
 * Three rules decided by the user on 2026-11-09 after Phú Dinh's review of the contract (PR #2).
 * The contract text is updated in a separate change; these tests already follow the decision.
 */
describe('rules decided 2026-11-09, contract update pending', () => {
  const h = useHarness();
  const lab = () => h().seed.labs.class1Open;
  const dueAt = () => new Date(h().seededAt.getTime() + SEED_WINDOWS.openLabDueAfterMs);

  it('rule 1: receivedAt is truncated to milliseconds, and a replay returns the identical receivedAt', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key });
    const original = expectAccepted(first, lab());
    expect(original.receivedAt).toMatch(/\.\d{3}Z$/);
    h().clock.advance(5_000);
    const replay = await submit(h(), { labId: lab(), key });
    expect(isReplay(replay)).toBe(true);
    expect(expectAccepted(replay, lab()).receivedAt).toBe(original.receivedAt);
  });

  it('rule 1: receivedAt is compared with the deadline as stored: just before the deadline is accepted, and stays before it', async () => {
    // The clock hook returns a Date, which cannot hold 0.4 ms; 1 ms before the deadline is the closest.
    const at = new Date(dueAt().getTime() - 1);
    h().clock.set(at);
    const res = await submit(h(), { labId: lab() });
    const receipt = expectAccepted(res, lab());
    expect(Date.parse(receipt.receivedAt)).toBeLessThan(dueAt().getTime());
    expect(receipt.receivedAt).toBe(at.toISOString());
  });

  it("rule 2: an upper-case labId of the student's open lab is accepted and the receipt's labId is lower case", async () => {
    const upper = lab().toUpperCase();
    const res = await submit(h(), { labId: upper });
    const receipt = expectAccepted(res, lab());
    expect(receipt.labId).toBe(lab().toLowerCase());
  });

  it('rule 3: 24 h minus 1 ms after the original receivedAt, the same key and body still replay', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key });
    const original = expectAccepted(first, lab());
    h().clock.set(new Date(Date.parse(original.receivedAt) + DAY_MS - 1));
    const retry = await submit(h(), { labId: lab(), key });
    expect(isReplay(retry)).toBe(true);
    expect(retry.body).toEqual(original);
  });

  it('rule 3: 24 h after the original receivedAt, the same key is a new key and creates a new submission', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key });
    const original = expectAccepted(first, lab());
    h().clock.set(new Date(Date.parse(original.receivedAt) + DAY_MS));
    const retry = await submit(h(), { labId: lab(), key });
    expect(isReplay(retry)).toBe(false);
    const fresh = expectAccepted(retry, lab());
    expect(fresh.id).not.toBe(original.id);
    expect(h().queue.calls).toEqual([original.id, fresh.id]);
  });
});
