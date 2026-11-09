import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import { DAY_MS, SEED_WINDOWS } from './hooks.js';
import {
  bearer,
  expectAccepted,
  expectProblem,
  expectUnauthenticated,
  expectValidationFailed,
  json,
  MAX_BODY_BYTES,
  MAX_SOURCE_BYTES,
  newKey,
  raw,
  signTestToken,
  submit,
  useHarness,
} from './helpers.js';

/** Section 4.4: when a request breaks two rules, the earlier step answers. */
describe('section 4.4: order of checks', () => {
  const h = useHarness();
  const lab = () => h().seed.labs.class1Open;

  it('4.4 steps 1 and 2: a wrong media type is answered before a body over 262,144 bytes (415, not 413)', async () => {
    const res = await submit(h(), {
      labId: lab(),
      contentType: 'text/plain',
      body: json({ source: 'a'.repeat(MAX_BODY_BYTES) }),
    });
    expectProblem(res, 'unsupported-media-type');
  });

  it('4.4 steps 2 and 3: a body over 262,144 bytes that is also not valid JSON gets 413, not 400', async () => {
    const res = await submit(h(), {
      labId: lab(),
      body: raw('{"source":"' + 'a'.repeat(MAX_BODY_BYTES)),
    });
    expectProblem(res, 'source-too-large');
  });

  it('4.4 steps 1 and 4: a wrong media type without a token gets 415, not 401', async () => {
    const res = await submit(h(), { labId: lab(), authorization: null, contentType: 'text/plain' });
    expectProblem(res, 'unsupported-media-type');
  });

  it('4.4 steps 3 and 4: malformed JSON without a token gets 400 malformed-json, not 401', async () => {
    const res = await submit(h(), { labId: lab(), authorization: null, body: raw('{"source":') });
    expectProblem(res, 'malformed-json');
  });

  it('4.4 steps 4 and 5: an expired ta token gets 401, not 403', async () => {
    const token = await signTestToken({ sub: h().seed.users.ta_a, role: 'ta', expiresIn: -60 });
    const res = await submit(h(), { labId: lab(), authorization: bearer(token) });
    expectUnauthenticated(res);
  });

  it('4.4 steps 5 and 6: a ta token without an Idempotency-Key gets 403, not 400', async () => {
    const res = await submit(h(), { labId: lab(), as: h().seed.users.ta_a, role: 'ta', key: null });
    expectProblem(res, 'forbidden-role');
  });

  it('4.4 steps 5 and 7: a ta token with an invalid body gets 403, not 422', async () => {
    const res = await submit(h(), {
      labId: lab(),
      as: h().seed.users.ta_a,
      role: 'ta',
      body: json({ source: 42 }),
    });
    expectProblem(res, 'forbidden-role');
  });

  it('4.4 steps 6 and 7: a missing key with an invalid body gets 400 idempotency-key-missing, not 422', async () => {
    const res = await submit(h(), { labId: lab(), key: null, body: json({}) });
    expectProblem(res, 'idempotency-key-missing');
  });

  it('4.4 steps 6 and 7: a malformed key with an invalid body gets 400 idempotency-key-invalid, not 422', async () => {
    const res = await submit(h(), { labId: lab(), key: 'has space', body: json({}) });
    expectProblem(res, 'idempotency-key-invalid');
  });

  it('4.4 step 7: a source over 65,536 bytes that also contains U+0000 gets 422, not 413', async () => {
    const res = await submit(h(), {
      labId: lab(),
      body: json({ source: 'a'.repeat(70 * 1024) + '\u0000' }),
    });
    expectValidationFailed(res, '/source');
  });

  it('4.4 steps 7 and 8: a non-member with an invalid body gets 422, not 404', async () => {
    const res = await submit(h(), { labId: lab(), as: h().seed.users.stu3, body: json({}) });
    expectValidationFailed(res, '/source');
  });

  it('4.4 steps 7 and 8: a source over 65,536 bytes for an unknown lab gets 413, not 404', async () => {
    const res = await submit(h(), {
      labId: randomUUID(),
      body: json({ source: 'a'.repeat(MAX_SOURCE_BYTES + 1) }),
    });
    expectProblem(res, 'source-too-large');
  });

  it('4.4 steps 8 and 10: a non-member gets 404 for a closed lab, not 409', async () => {
    const res = await submit(h(), { labId: h().seed.labs.class1Closed, as: h().seed.users.stu3 });
    expectProblem(res, 'lab-not-found');
  });

  it('4.4 steps 9 and 10: a reused key with a different body after the deadline gets 422 idempotency-key-reused, not 409', async () => {
    const key = newKey();
    const first = await submit(h(), { labId: lab(), key, body: json({ source: 'int main() {}' }) });
    expectAccepted(first, lab());
    h().clock.set(new Date(h().seededAt.getTime() + SEED_WINDOWS.openLabDueAfterMs + DAY_MS));
    const res = await submit(h(), { labId: lab(), key, body: json({ source: 'int main() { }' }) });
    expectProblem(res, 'idempotency-key-reused');
  });
});
