import { describe, expect, it } from 'vitest';
import {
  expectAccepted,
  expectProblem,
  isReplay,
  json,
  MAX_SOURCE_BYTES,
  newKey,
  raw,
  SOURCE,
  submit,
  useHarness,
} from './helpers.js';

describe('section 4.5: idempotency', () => {
  const h = useHarness();
  const lab = () => h().seed.labs.class1Open;

  it('4.5: no Idempotency-Key header gets 400 idempotency-key-missing and nothing is created', async () => {
    const res = await submit(h(), { labId: lab(), key: null });
    expectProblem(res, 'idempotency-key-missing');
    expect(h().queue.calls).toEqual([]);
  });

  it('4.5: a key that breaks the key rules gets 400 idempotency-key-invalid and nothing is created', async () => {
    const res = await submit(h(), { labId: lab(), key: 'k'.repeat(256) });
    expectProblem(res, 'idempotency-key-invalid');
    expect(h().queue.calls).toEqual([]);
  });

  it('4.5: same key and same body replays the stored 202: identical body, same Location, Idempotent-Replayed: true', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key });
    const again = await submit(h(), { labId: lab(), key });
    const original = expectAccepted(first, lab());
    expect(isReplay(first)).toBe(false);
    expect(again.status).toBe(202);
    expect(again.body).toEqual(original);
    expect(again.get('Location')).toBe(first.get('Location'));
    expect(again.get('Idempotent-Replayed')).toBe('true');
  });

  it('4.5: a replay creates no new submission', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key });
    await submit(h(), { labId: lab(), key });
    await submit(h(), { labId: lab(), key });
    expect(h().queue.calls).toEqual([expectAccepted(first, lab()).id]);
  });

  it('4.5: key order and whitespace between JSON tokens do not count: still a replay', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key, body: json({ source: SOURCE }) });
    const spaced = raw(`{\n  "source" :  ${JSON.stringify(SOURCE)}\n}\n`);
    const again = await submit(h(), { labId: lab(), key, body: spaced });
    expect(isReplay(again)).toBe(true);
    expect(again.body).toEqual(expectAccepted(first, lab()));
  });

  it('4.5: unknown fields are dropped before comparing: still a replay', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key, body: json({ source: SOURCE }) });
    const again = await submit(h(), {
      labId: lab(),
      key,
      body: json({ editor: 'vscode', source: SOURCE }),
    });
    expect(isReplay(again)).toBe(true);
    expect(again.body).toEqual(expectAccepted(first, lab()));
  });

  it('4.5: same key with a source that differs only in whitespace gets 422 idempotency-key-reused and nothing is created', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key, body: json({ source: 'int main() {}' }) });
    const changed = await submit(h(), {
      labId: lab(),
      key,
      body: json({ source: 'int main() { }' }),
    });
    const original = expectAccepted(first, lab());
    expectProblem(changed, 'idempotency-key-reused');
    expect(h().queue.calls).toEqual([original.id]);
  });

  it('4.5: keys are compared exactly, case included', async () => {
    const lower = await submit(h(), { labId: lab(), key: 'retry-key-a' });
    const upper = await submit(h(), { labId: lab(), key: 'RETRY-KEY-A' });
    expect(isReplay(upper)).toBe(false);
    expect(expectAccepted(upper, lab()).id).not.toBe(expectAccepted(lower, lab()).id);
  });

  it('4.5: the same key from another student is unrelated: a new submission', async () => {
    const key = newKey();
    const stu1 = await submit(h(), { labId: lab(), key, as: h().seed.users.stu1 });
    const stu2 = await submit(h(), { labId: lab(), key, as: h().seed.users.stu2 });
    expect(isReplay(stu2)).toBe(false);
    expect(expectAccepted(stu2, lab()).id).not.toBe(expectAccepted(stu1, lab()).id);
  });

  it('4.5: the same key for another lab is unrelated: that lab gives its own answer, not a replay', async () => {
    const key = newKey();
    const open = await submit(h(), { labId: lab(), key });
    expectAccepted(open, lab());
    // The seed gives class 1 only one open lab, so the other lab is the one not open yet:
    // a key scoped per (student, lab) is unknown there, and the time window answers.
    const other = await submit(h(), { labId: h().seed.labs.class1NotOpen, key });
    expectProblem(other, 'lab-not-open');
  });

  it('4.5: two requests with the same key at the same moment create exactly one submission', async () => {
    const key = newKey();
    const [a, b] = await Promise.all([
      submit(h(), { labId: lab(), key }),
      submit(h(), { labId: lab(), key }),
    ]);
    const first = expectAccepted(a, lab());
    const second = expectAccepted(b, lab());
    expect(second.id).toBe(first.id);
    expect([isReplay(a), isReplay(b)].filter(Boolean)).toHaveLength(1);
    expect(h().queue.calls).toEqual([first.id]);
  });

  it('4.5: two requests with the same key and different bodies at the same moment: one 202, one 422 idempotency-key-reused', async () => {
    const key = newKey();
    const responses = await Promise.all([
      submit(h(), { labId: lab(), key, body: json({ source: 'int main() { return 1; }' }) }),
      submit(h(), { labId: lab(), key, body: json({ source: 'int main() { return 2; }' }) }),
    ]);
    expect(responses.filter((res) => res.status === 202)).toHaveLength(1);
    const rejected = responses.find((res) => res.status !== 202);
    if (!rejected) throw new Error('expected one of the two requests to be rejected');
    expectProblem(rejected, 'idempotency-key-reused');
    expect(h().queue.calls).toHaveLength(1);
  });

  it('4.5: a key whose first request ended in a 4xx is free: the fixed request creates a submission', async () => {
    const key = newKey();
    const broken = await submit(h(), { labId: lab(), key, body: json({ source: 42 }) });
    expectProblem(broken, 'validation-failed');
    const fixed = await submit(h(), { labId: lab(), key });
    expectAccepted(fixed, lab());
    expect(isReplay(fixed)).toBe(false);
  });

  it('4.5: a key whose first request got 413 is free: a shorter source with the same key creates a submission', async () => {
    const key = newKey();
    const tooLarge = await submit(h(), {
      labId: lab(),
      key,
      body: json({ source: 'a'.repeat(MAX_SOURCE_BYTES + 1) }),
    });
    expectProblem(tooLarge, 'source-too-large');
    const shorter = await submit(h(), { labId: lab(), key });
    expectAccepted(shorter, lab());
    expect(isReplay(shorter)).toBe(false);
  });
});
