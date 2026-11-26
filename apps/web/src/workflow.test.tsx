// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

it('lets a student choose a lab and see its constraints without hidden test data', async () => {
  const token = `header.${btoa(JSON.stringify({ role: 'student' }))}.signature`;
  const mockFetch = vi.fn<typeof fetch>((input) => {
    const url = requestUrl(input);
    let body: unknown;
    if (url === '/v1/auth/login') body = { accessToken: token };
    else if (url === '/v1/classes') body = [{ id: 'class-1', code: 'CSC1', name: 'Class one' }];
    else if (url === '/v1/classes/class-1/labs')
      body = [
        {
          id: 'lab-1',
          title: 'Lab one',
          opensAt: '2026-11-23T00:00:00Z',
          deadlineAt: '2026-11-30T00:00:00Z',
          statement: 'Example statement',
          constraints: [{ id: 'c1', text: 'Use a loop', deduction: 1.25 }],
        },
      ];
    else if (url === '/v1/submissions') body = [];
    else throw new Error(`Unexpected request: ${url}`);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal('fetch', mockFetch);
  render(<App />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example passphrase' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
  fireEvent.click(await screen.findByRole('button', { name: /CSC1/ }));
  expect(await screen.findByText('Example statement')).toBeTruthy();
  expect(screen.getByText(/Use a loop/)).toBeTruthy();
  expect(screen.getByText(/model receives/)).toBeTruthy();
  expect(screen.queryByText(/Expected output/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create class' })).toBeNull();
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/v1/submissions', expect.anything()));
});

it('allows an administrator to assign a TA to a selected class', async () => {
  const token = `header.${btoa(JSON.stringify({ role: 'admin' }))}.signature`;
  const mockFetch = vi.fn<typeof fetch>((input) => {
    const url = requestUrl(input);
    const body: unknown =
      url === '/v1/auth/login'
        ? { accessToken: token }
        : url === '/v1/classes'
          ? [{ id: 'class-1', code: 'CSC1', name: 'Class one' }]
          : { added: true };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal('fetch', mockFetch);
  render(<App />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example passphrase' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
  fireEvent.click(await screen.findByRole('button', { name: /CSC1/ }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ta@example.test' } });
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'TA' } });
  fireEvent.change(screen.getByLabelText(/Initial password/), {
    target: { value: 'example passphrase' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Add member' }).closest('form')!);
  expect((await screen.findByRole('status')).textContent).toContain('Member added.');
  const assignment = mockFetch.mock.calls.find(([url]) => url === '/v1/classes/class-1/tas');
  expect(assignment?.[1]?.body).toBe(
    JSON.stringify({ email: 'ta@example.test', displayName: 'TA', password: 'example passphrase' }),
  );
});

it('submits a TA lab with constraints and test cases', async () => {
  const token = `header.${btoa(JSON.stringify({ role: 'ta' }))}.signature`;
  const mockFetch = vi.fn<typeof fetch>((input, options) => {
    const url = requestUrl(input);
    let body: unknown = {};
    if (url === '/v1/auth/login') body = { accessToken: token };
    else if (url === '/v1/classes') body = [{ id: 'class-1', code: 'CSC1', name: 'Class one' }];
    else if (url === '/v1/classes/class-1/labs' && options?.method === 'GET') body = [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal('fetch', mockFetch);
  render(<App />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ta@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example passphrase' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
  fireEvent.click(await screen.findByRole('button', { name: /CSC1/ }));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Loop lab' } });
  fireEvent.change(screen.getByLabelText('Problem statement'), {
    target: { value: 'Add numbers' },
  });
  fireEvent.change(screen.getByLabelText('Constraint 1'), { target: { value: 'Use a loop' } });
  fireEvent.change(screen.getByLabelText('Deduction (points)'), { target: { value: '1.25' } });
  fireEvent.change(screen.getByLabelText('Test 1 input'), { target: { value: '2 3' } });
  fireEvent.change(screen.getByLabelText('Expected output'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Opens'), { target: { value: '2026-11-24T12:00' } });
  fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2026-11-25T12:00' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Create lab' }).closest('form')!);
  expect((await screen.findByRole('status')).textContent).toContain('Lab created.');
  const call = mockFetch.mock.calls.find(
    ([url, options]) => url === '/v1/classes/class-1/labs' && options?.method === 'POST',
  );
  expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({
    statement: 'Add numbers',
    constraints: [{ text: 'Use a loop', deduction: 1.25 }],
    testCases: [{ input: '2 3', expectedOutput: '5' }],
  });
});

it('submits a selected C++ file with an idempotency key', async () => {
  const token = `header.${btoa(JSON.stringify({ role: 'student' }))}.signature`;
  const mockFetch = vi.fn<typeof fetch>((input) => {
    const url = requestUrl(input);
    let body: unknown = {};
    if (url === '/v1/auth/login') body = { accessToken: token };
    else if (url === '/v1/classes') body = [{ id: 'class-1', code: 'CSC1', name: 'Class one' }];
    else if (url === '/v1/classes/class-1/labs')
      body = [
        {
          id: 'lab-1',
          title: 'Lab one',
          opensAt: '2026-11-23T00:00:00Z',
          deadlineAt: '2026-11-30T00:00:00Z',
        },
      ];
    else if (url === '/v1/submissions') body = [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal('fetch', mockFetch);
  render(<App />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example passphrase' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
  fireEvent.click(await screen.findByRole('button', { name: /CSC1/ }));
  await screen.findByRole('option', { name: 'Lab one' });
  fireEvent.change(screen.getByLabelText('Lab'), { target: { value: 'lab-1' } });
  const file = new File(['int main() {}'], 'solution.cpp', { type: 'text/plain' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve('int main() {}') });
  fireEvent.change(screen.getByLabelText('C++ file'), { target: { files: [file] } });
  fireEvent.submit(screen.getByRole('button', { name: 'Submit' }).closest('form')!);
  expect((await screen.findByRole('status')).textContent).toContain('Submission received.');
  const call = mockFetch.mock.calls.find(([url]) => url === '/v1/labs/lab-1/submissions');
  expect(call?.[1]?.body).toBe(JSON.stringify({ source: 'int main() {}' }));
  expect(call?.[1]?.headers).toHaveProperty('Idempotency-Key');
});
