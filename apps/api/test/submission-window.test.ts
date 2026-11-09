import { beforeEach, describe, expect, it } from 'vitest';
import { SubmissionsService } from '../src/submissions/submissions.service.js';
import { FakeSubmissionData, LAB_ID, STUDENT_ID } from './fake-submission-data.js';

const receivedAt = new Date('2026-11-09T12:00:00.000Z');
const data = new FakeSubmissionData();
const service = new SubmissionsService(data, { enqueue: () => Promise.resolve() });

beforeEach(() => {
  data.reset();
  data.lab = { id: LAB_ID, opensAt: receivedAt, deadlineAt: new Date(receivedAt.getTime() + 1000) };
});

describe('submission receive-time boundaries', () => {
  it('accepts exactly at opening and stores the captured receive time', async () => {
    const result = await service.submit(STUDENT_ID, LAB_ID, 'key', { source: 'x' }, receivedAt);
    expect(result.receipt.receivedAt).toBe(receivedAt.toISOString());
    expect(data.submissions[0]?.expiresAt.toISOString()).toBe('2026-11-10T12:00:00.000Z');
  });
  it('rejects exactly at the deadline', async () => {
    await expect(
      service.submit(STUDENT_ID, LAB_ID, 'key', { source: 'x' }, data.lab!.deadlineAt),
    ).rejects.toMatchObject({
      response: { status: 409, type: 'https://leetkob.example/problems/lab-closed' },
    });
    expect(data.submissions).toHaveLength(0);
  });
  it('treats a key as expired at exactly 24 hours', async () => {
    const first = await service.submit(STUDENT_ID, LAB_ID, 'key', { source: 'x' }, receivedAt);
    const nextDay = new Date(receivedAt.getTime() + 86400000);
    data.lab!.deadlineAt = new Date(nextDay.getTime() + 1000);
    const second = await service.submit(STUDENT_ID, LAB_ID, 'key', { source: 'y' }, nextDay);
    expect(second.replayed).toBe(false);
    expect(second.receipt.id).not.toBe(first.receipt.id);
    expect(data.submissions).toHaveLength(2);
  });
});
