import { describe, expect, it, vi } from 'vitest';
import { LabsController } from '../src/classes/labs.controller.js';
import type { Labs } from '../src/classes/labs.js';
import type { SubmissionRequest } from '../src/common/request.js';

const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ta = {
  user: { id: '11111111-1111-4111-8111-111111111111', role: 'ta' },
} as SubmissionRequest;
const draft = {
  title: 'Example',
  statement: 'Problem',
  opensAt: '2026-11-24T00:00:00Z',
  deadlineAt: '2026-11-25T00:00:00Z',
  cpuLimitSeconds: 1,
  memoryLimitMb: 256,
  constraints: [{ text: 'Use a loop', deduction: 1.25 }],
  testCases: [{ input: '1', expectedOutput: '1' }],
};

function setup() {
  const create = vi.fn<Labs['create']>().mockResolvedValue({
    id: classId,
    classId,
    title: 'Example',
    opensAt: new Date(draft.opensAt),
    deadlineAt: new Date(draft.deadlineAt),
  });
  const list = vi.fn<Labs['list']>().mockResolvedValue([]);
  return { controller: new LabsController({ create, list }), create };
}

describe('lab configuration', () => {
  it('passes validated limits, constraints and cases to storage', async () => {
    const { controller, create } = setup();
    await controller.create(ta, classId, draft);
    expect(create).toHaveBeenCalledWith(
      ta.user,
      classId,
      expect.objectContaining({
        statement: draft.statement,
        cpuLimitSeconds: 1,
        memoryLimitMb: 256,
        constraints: draft.constraints,
        testCases: draft.testCases,
      }),
    );
  });

  it('rejects invalid windows, limits and malformed test data', async () => {
    const { controller, create } = setup();
    for (const invalid of [
      { ...draft, opensAt: '2026-02-30T00:00:00Z' },
      { ...draft, cpuLimitSeconds: 6 },
      { ...draft, memoryLimitMb: 32 },
      { ...draft, constraints: [{ text: 'Rule', deduction: 10.01 }] },
      { ...draft, testCases: [{ input: 'bad\0input', expectedOutput: '' }] },
    ])
      await expect(controller.create(ta, classId, invalid)).rejects.toMatchObject({ status: 422 });
    expect(create).not.toHaveBeenCalled();
  });
});
