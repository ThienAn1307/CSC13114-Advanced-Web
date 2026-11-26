// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReviewQueue } from './ReviewQueue.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('requires a TA to select a decision and sends matching source evidence', async () => {
  const proposal = {
    id: 'proposal-1',
    submissionId: 'submission-1',
    constraintId: 'constraint-1',
    labId: 'lab-1',
    labTitle: 'Lab one',
    constraint: 'Use a loop',
    deduction: 1.25,
    verdict: 'unsure',
    evidence: [],
    reason: null,
    unsureCause: 'timeout',
    decidedBy: 'guardrail',
    decision: null,
    source: 'first line\nsecond line',
  };
  const mockFetch = vi.fn<typeof fetch>((input, options) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = url.endsWith('/decision') ? { decision: 'violation' } : [proposal];
    void options;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal('fetch', mockFetch);
  render(<ReviewQueue classId="class-1" token="test-token" />);
  expect(await screen.findByText(/timeout/)).toBeTruthy();
  const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Save decision' });
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'violation' } });
  fireEvent.change(screen.getByLabelText('Evidence line numbers'), { target: { value: '2' } });
  fireEvent.click(submit);
  expect((await screen.findByRole('status')).textContent).toContain('Decision saved');
  const call = mockFetch.mock.calls.find(
    ([input]) => input === '/v1/classes/class-1/reviews/proposal-1/decision',
  );
  expect(call?.[1]?.body).toBe(
    JSON.stringify({ decision: 'violation', evidence: [{ line: 2, text: 'second line' }] }),
  );
});
