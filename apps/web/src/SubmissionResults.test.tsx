// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SubmissionResults } from './SubmissionResults.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows the student only per-test verdicts', async () => {
  const mockFetch = vi.fn<typeof fetch>(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve([
          { position: 1, status: 'AC' },
          { position: 2, status: 'WA' },
        ]),
    } as Response),
  );
  vi.stubGlobal('fetch', mockFetch);
  render(<SubmissionResults submissionId="one" token="test-token" status="WA" />);
  fireEvent.click(screen.getByRole('button', { name: 'View test verdicts' }));
  expect(await screen.findByText('Test 1: AC')).toBeTruthy();
  expect(screen.getByText('Test 2: WA')).toBeTruthy();
  expect(screen.queryByText(/input/i)).toBeNull();
  expect(screen.queryByText(/output/i)).toBeNull();
});
