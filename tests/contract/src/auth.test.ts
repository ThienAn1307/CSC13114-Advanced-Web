import { describe, expect, it } from 'vitest';
import {
  bearer,
  expectAccepted,
  expectUnauthenticated,
  signTestToken,
  submit,
  useHarness,
  withBadSignature,
} from './helpers.js';

describe('section 1: authentication', () => {
  const h = useHarness();

  it('section 1: a request with no Authorization header gets 401 unauthenticated and WWW-Authenticate: Bearer', async () => {
    const res = await submit(h(), { labId: h().seed.labs.class1Open, authorization: null });
    expectUnauthenticated(res);
  });

  it('section 1: a scheme other than Bearer gets 401 unauthenticated', async () => {
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: 'Basic c3R1MTpwYXNzd29yZA==',
    });
    expectUnauthenticated(res);
  });

  it('section 1: a Bearer value that is not a JWT gets 401 unauthenticated', async () => {
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: 'Bearer not-a-jwt',
    });
    expectUnauthenticated(res);
  });

  it('section 1: a token whose signature does not verify gets 401 unauthenticated', async () => {
    const token = await signTestToken({ sub: h().seed.users.stu1, role: 'student' });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(withBadSignature(token)),
    });
    expectUnauthenticated(res);
  });

  it('section 1: a token with alg none gets 401 unauthenticated', async () => {
    const token = await signTestToken({ sub: h().seed.users.stu1, role: 'student', alg: 'none' });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(token),
    });
    expectUnauthenticated(res);
  });

  it('section 1: a token signed with an algorithm other than HS256 gets 401 unauthenticated', async () => {
    const token = await signTestToken({ sub: h().seed.users.stu1, role: 'student', alg: 'HS512' });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(token),
    });
    expectUnauthenticated(res);
  });

  it('section 1: an expired token gets 401 unauthenticated', async () => {
    const token = await signTestToken({
      sub: h().seed.users.stu1,
      role: 'student',
      expiresIn: -60,
    });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(token),
    });
    expectUnauthenticated(res);
  });

  it('section 1: a token without exp gets 401 unauthenticated', async () => {
    const token = await signTestToken({
      sub: h().seed.users.stu1,
      role: 'student',
      expiresIn: null,
    });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(token),
    });
    expectUnauthenticated(res);
  });

  it('section 1: a token without sub gets 401 unauthenticated', async () => {
    const token = await signTestToken({ sub: null, role: 'student' });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(token),
    });
    expectUnauthenticated(res);
  });

  it('section 1: a token whose sub is not a UUID gets 401 unauthenticated', async () => {
    const token = await signTestToken({ sub: 'stu1', role: 'student' });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(token),
    });
    expectUnauthenticated(res);
  });

  it('section 1: a token without role gets 401 unauthenticated', async () => {
    const token = await signTestToken({ sub: h().seed.users.stu1, role: null });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(token),
    });
    expectUnauthenticated(res);
  });

  it('section 1: a token with a role other than student, ta or admin gets 401 unauthenticated', async () => {
    const token = await signTestToken({ sub: h().seed.users.stu1, role: 'teacher' });
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      authorization: bearer(token),
    });
    expectUnauthenticated(res);
  });

  it('section 1: the 401 does not say which rule failed', async () => {
    const labId = h().seed.labs.class1Open;
    const valid = await signTestToken({ sub: h().seed.users.stu1, role: 'student' });
    const expired = await signTestToken({
      sub: h().seed.users.stu1,
      role: 'student',
      expiresIn: -60,
    });
    const missing = await submit(h(), { labId, authorization: null });
    const badSignature = await submit(h(), {
      labId,
      authorization: bearer(withBadSignature(valid)),
    });
    const tooOld = await submit(h(), { labId, authorization: bearer(expired) });
    const first = expectUnauthenticated(missing);
    expect(expectUnauthenticated(badSignature)).toEqual(first);
    expect(expectUnauthenticated(tooOld)).toEqual(first);
  });

  it('section 1: claims other than alg, exp, sub and role are ignored', async () => {
    const labId = h().seed.labs.class1Open;
    const token = await signTestToken({
      sub: h().seed.users.stu1,
      role: 'student',
      extraClaims: { iss: 'someone-else', name: 'Student One', scope: 'admin' },
    });
    const res = await submit(h(), { labId, authorization: bearer(token) });
    expectAccepted(res, labId);
  });
});
