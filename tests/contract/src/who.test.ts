import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  expectAccepted,
  expectProblem,
  isReplay,
  json,
  newKey,
  SOURCE,
  submit,
  useHarness,
} from './helpers.js';

describe('section 4.1: who may call it', () => {
  const h = useHarness();

  it("4.1: a student of the lab's class gets 202", async () => {
    const labId = h().seed.labs.class1Open;
    const res = await submit(h(), { labId, as: h().seed.users.stu1 });
    expectAccepted(res, labId);
  });

  it("4.1: a ta token gets 403 forbidden-role for an existing lab of the TA's own class", async () => {
    const res = await submit(h(), {
      labId: h().seed.labs.class1Open,
      as: h().seed.users.ta_a,
      role: 'ta',
    });
    expectProblem(res, 'forbidden-role');
  });

  it('4.1: a ta token gets 403 forbidden-role for a lab id that does not exist', async () => {
    const res = await submit(h(), { labId: randomUUID(), as: h().seed.users.ta_a, role: 'ta' });
    expectProblem(res, 'forbidden-role');
  });

  it('4.1: an admin token gets 403 forbidden-role for an existing lab', async () => {
    const res = await submit(h(), {
      labId: h().seed.labs.class2Open,
      as: h().seed.users.admin,
      role: 'admin',
    });
    expectProblem(res, 'forbidden-role');
  });

  it('4.1: an admin token gets 403 forbidden-role for a lab id that does not exist', async () => {
    const res = await submit(h(), { labId: randomUUID(), as: h().seed.users.admin, role: 'admin' });
    expectProblem(res, 'forbidden-role');
  });

  it('4.1: the 403 for an existing lab and for an unknown lab are the same', async () => {
    const existing = await submit(h(), {
      labId: h().seed.labs.class1Open,
      as: h().seed.users.ta_a,
      role: 'ta',
    });
    const unknown = await submit(h(), { labId: randomUUID(), as: h().seed.users.ta_a, role: 'ta' });
    expect(expectProblem(unknown, 'forbidden-role')).toEqual(
      expectProblem(existing, 'forbidden-role'),
    );
  });

  it('4.1: a lab of another class gets the same 404 lab-not-found as a lab that does not exist', async () => {
    const otherClassLab = h().seed.labs.class1Open;
    const unknownLab = randomUUID();
    const otherClass = await submit(h(), { labId: otherClassLab, as: h().seed.users.stu3 });
    const unknown = await submit(h(), { labId: unknownLab, as: h().seed.users.stu3 });
    const a = expectProblem(otherClass, 'lab-not-found');
    const b = expectProblem(unknown, 'lab-not-found');
    // A detail may name the lab id the client sent; apart from that the two must be identical.
    const normalise = (body: object, labId: string) =>
      JSON.stringify(body).split(labId).join('{labId}');
    expect(normalise(a, otherClassLab)).toBe(normalise(b, unknownLab));
  });

  it("4.1: the body cannot name another student: the submission is the caller's own", async () => {
    const labId = h().seed.labs.class1Open;
    const key = newKey();
    const body = json({ source: SOURCE, studentId: h().seed.users.stu2 });
    const asStu1 = await submit(h(), { labId, as: h().seed.users.stu1, key, body });
    const asStu2 = await submit(h(), { labId, as: h().seed.users.stu2, key, body });
    const first = expectAccepted(asStu1, labId);
    const second = expectAccepted(asStu2, labId);
    // Keys are per (student, lab): if the first had been stored as stu2's, this would be a replay.
    expect(isReplay(asStu2)).toBe(false);
    expect(second.id).not.toBe(first.id);
  });
});
