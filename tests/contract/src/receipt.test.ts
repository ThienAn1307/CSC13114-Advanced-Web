import { describe, expect, it } from 'vitest';
import { HOUR_MS } from './hooks.js';
import { expectAccepted, isReplay, json, submit, useHarness, utf8Bytes } from './helpers.js';

describe('sections 3 and 4.3: the 202 receipt', () => {
  const h = useHarness();
  const lab = () => h().seed.labs.class1Open;

  it('4.3: a valid submission gets 202 Accepted with Content-Type application/json and the receipt', async () => {
    const res = await submit(h(), { labId: lab() });
    const receipt = expectAccepted(res, lab());
    expect(Object.keys(receipt)).toEqual(
      expect.arrayContaining(['id', 'labId', 'status', 'receivedAt', 'sizeBytes']),
    );
  });

  it('4.3: Location is /v1/submissions/{id} with the id from the receipt', async () => {
    const res = await submit(h(), { labId: lab() });
    const receipt = expectAccepted(res, lab());
    expect(res.get('Location')).toBe(`/v1/submissions/${receipt.id}`);
  });

  it('4.3: the first response does not carry Idempotent-Replayed', async () => {
    const res = await submit(h(), { labId: lab() });
    expectAccepted(res, lab());
    expect(res.get('Idempotent-Replayed')).toBeUndefined();
    expect(isReplay(res)).toBe(false);
  });

  it('section 3: status is "queued"', async () => {
    const res = await submit(h(), { labId: lab() });
    expect(expectAccepted(res, lab()).status).toBe('queued');
  });

  it('section 3: receivedAt is the time the server received the request, in UTC with milliseconds', async () => {
    const at = new Date(h().seededAt.getTime() + 2 * HOUR_MS + 345);
    h().clock.set(at);
    const res = await submit(h(), { labId: lab() });
    expect(expectAccepted(res, lab()).receivedAt).toBe(at.toISOString());
  });

  it('section 3: sizeBytes is the length of source in UTF-8 bytes, not in characters', async () => {
    const source = 'int main() { /* é ✓ \u{1F600} */ return 0; }\n';
    expect(utf8Bytes(source)).not.toBe(source.length);
    const res = await submit(h(), { labId: lab(), body: json({ source }) });
    expect(expectAccepted(res, lab()).sizeBytes).toBe(utf8Bytes(source));
  });

  it('section 3: labId is the lab from the path and id is a new lowercase UUID', async () => {
    const res = await submit(h(), { labId: lab() });
    const receipt = expectAccepted(res, lab());
    expect(receipt.labId).toBe(lab().toLowerCase());
    expect(receipt.id).not.toBe(receipt.labId);
  });

  it('4.3: the new submission is put on the judging queue with its id', async () => {
    const res = await submit(h(), { labId: lab() });
    const receipt = expectAccepted(res, lab());
    expect(h().queue.calls).toEqual([receipt.id]);
  });
});
