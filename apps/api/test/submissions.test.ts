import { createHmac, randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, MAX_BODY_BYTES } from '../src/app.js';
import { validateConfig } from '../src/config.js';
import { FakeSubmissionData, LAB_ID, STUDENT_ID } from './fake-submission-data.js';

// Ephemeral signing material generated in memory; no real key or .env access.
const signingMaterial = randomBytes(32).toString('hex');
const data = new FakeSubmissionData();
const enqueue = vi.fn<(id: string) => Promise<void>>();
let app: NestExpressApplication;
let origin: string;

function token(
  claims: Record<string, unknown> = {},
  alg = 'HS256',
  material = signingMaterial,
): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: STUDENT_ID, role: 'student', exp: Date.now() / 1000 + 3600, ...claims }),
  ).toString('base64url');
  const value = `${header}.${payload}`;
  return `${value}.${createHmac('sha256', material).update(value).digest('base64url')}`;
}

interface RequestOptions {
  body?: string;
  headers?: Record<string, string>;
  omit?: string[];
  labId?: string;
}

async function post(options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token()}`,
    'Idempotency-Key': 'submission-key',
    ...options.headers,
  };
  for (const name of options.omit ?? []) delete headers[name];
  return fetch(`${origin}/v1/labs/${options.labId ?? LAB_ID}/submissions`, {
    method: 'POST',
    headers,
    body: options.body ?? JSON.stringify({ source: 'int main() {}' }),
  });
}

async function expectProblem(
  response: Response,
  status: number,
  slug: string,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ type: `https://leetkob.example/problems/${slug}`, status });
  expect(typeof body.title).toBe('string');
  expect(typeof body.detail).toBe('string');
  if (slug !== 'validation-failed') expect(body).not.toHaveProperty('errors');
  expect(data.submissions).toHaveLength(0);
  return body;
}

beforeAll(async () => {
  app = await createApp({
    config: { jwtSecret: signingMaterial, port: 3000 },
    data,
    queue: { enqueue },
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  data.reset();
  enqueue.mockReset().mockResolvedValue(undefined);
});

describe('submission HTTP implementation with fake data', () => {
  it('returns a canonical 202 receipt and stores only the authenticated owner', async () => {
    const response = await post({
      labId: LAB_ID.toUpperCase(),
      body: JSON.stringify({ source: '😀', studentId: 'ignored' }),
      headers: { 'Content-Type': 'APPLICATION/JSON; CHARSET=UTF-8' },
    });
    expect(response.status).toBe(202);
    const receipt = (await response.json()) as Record<string, unknown>;
    expect(receipt).toMatchObject({ labId: LAB_ID, status: 'queued', sizeBytes: 4 });
    expect(receipt.receivedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(response.headers.get('location')).toBe(`/v1/submissions/${String(receipt.id)}`);
    expect(response.headers.has('idempotent-replayed')).toBe(false);
    expect(data.submissions[0]).toMatchObject({ studentId: STUDENT_ID, source: '😀', receipt });
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(receipt.id);
  });

  it.each([
    'text/plain',
    'application/json; charset=latin1',
    'application/json; extra=value',
    'application/jsonx',
  ])('rejects media type %s before parsing or authentication', async (contentType) => {
    await expectProblem(
      await post({ headers: { 'Content-Type': contentType }, body: '{', omit: ['Authorization'] }),
      415,
      'unsupported-media-type',
    );
    expect(data.reads).toBe(0);
  });
  it('rejects a missing media type', async () => {
    // fetch adds text/plain for strings when Content-Type is omitted, still a 415.
    await expectProblem(await post({ omit: ['Content-Type'] }), 415, 'unsupported-media-type');
  });
  it('checks whole body size before malformed JSON and authentication', async () => {
    await expectProblem(
      await post({ body: 'x'.repeat(MAX_BODY_BYTES + 1), omit: ['Authorization'] }),
      413,
      'source-too-large',
    );
  });
  it('accepts a body exactly at the wire limit', async () => {
    const small = JSON.stringify({ source: 'x' });
    expect((await post({ body: small + ' '.repeat(MAX_BODY_BYTES - small.length) })).status).toBe(
      202,
    );
  });
  it('checks malformed JSON before authentication', async () => {
    await expectProblem(await post({ body: '{', omit: ['Authorization'] }), 400, 'malformed-json');
  });
  it.each([
    ['missing', undefined],
    ['scheme', 'Basic invalid'],
    ['bad signature', `Bearer ${token({}, 'HS256', randomBytes(32).toString('hex'))}`],
    ['expired', `Bearer ${token({ exp: 0 })}`],
    ['missing expiry', `Bearer ${token({ exp: undefined })}`],
    ['wrong algorithm', `Bearer ${token({}, 'HS384')}`],
    ['none', `Bearer ${token({}, 'none')}`],
    ['bad sub', `Bearer ${token({ sub: 'bad' })}`],
    ['missing sub', `Bearer ${token({ sub: undefined })}`],
    ['bad role', `Bearer ${token({ role: 'teacher' })}`],
    ['array role', `Bearer ${token({ role: ['student'] })}`],
    ['trailing token', `Bearer ${token()} extra`],
  ])('rejects %s credentials without revealing details', async (_label, authorization) => {
    const response = await post(
      authorization === undefined
        ? { omit: ['Authorization'] }
        : { headers: { Authorization: authorization } },
    );
    await expectProblem(response, 401, 'unauthenticated');
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(data.reads).toBe(0);
  });
  it('ignores claims outside the contract', async () => {
    expect(
      (
        await post({
          headers: { Authorization: `Bearer ${token({ nbf: Date.now() / 1000 + 10000 })}` },
        })
      ).status,
    ).toBe(202);
  });
  it.each(['ta', 'admin'])(
    'rejects role %s before the key, body fields and lab lookup',
    async (role) => {
      await expectProblem(
        await post({
          headers: { Authorization: `Bearer ${token({ role })}` },
          omit: ['Idempotency-Key'],
          body: '{}',
          labId: 'invalid',
        }),
        403,
        'forbidden-role',
      );
      expect(data.reads).toBe(0);
    },
  );
  it('checks missing idempotency key before field validation', async () => {
    await expectProblem(
      await post({ omit: ['Idempotency-Key'], body: '{}' }),
      400,
      'idempotency-key-missing',
    );
  });
  it.each(['', 'contains space', 'x'.repeat(256)])('rejects an invalid key', async (key) => {
    await expectProblem(
      await post({ headers: { 'Idempotency-Key': key } }),
      400,
      'idempotency-key-invalid',
    );
  });
  it.each([null, [], 'text', 123, true])(
    'uses the root pointer for a non-object body: %j',
    async (body) => {
      const result = await expectProblem(
        await post({ body: JSON.stringify(body) }),
        422,
        'validation-failed',
      );
      expect(result.errors).toEqual([{ pointer: '', detail: 'must be a JSON object' }]);
    },
  );
  it.each([
    {},
    { source: '' },
    { source: null },
    { source: 42 },
    { source: 'a\u0000b' },
    { source: '\ud800' },
    { source: '\udfff' },
    { source: '\ud800\ud800' },
  ])('returns one errors entry per invalid field: %j', async (body) => {
    const result = await expectProblem(
      await post({ body: JSON.stringify(body) }),
      422,
      'validation-failed',
    );
    const expectedDetail: unknown = expect.any(String);
    expect(result.errors).toEqual([{ pointer: '/source', detail: expectedDetail }]);
  });
  it('validates Unicode before source size', async () => {
    await expectProblem(
      await post({ body: JSON.stringify({ source: 'x'.repeat(65537) + '\u0000' }) }),
      422,
      'validation-failed',
    );
  });
  it('accepts exactly 65,536 UTF-8 source bytes', async () => {
    expect((await post({ body: JSON.stringify({ source: 'đ'.repeat(32768) }) })).status).toBe(202);
  });
  it('rejects 65,537 UTF-8 source bytes before lab lookup', async () => {
    await expectProblem(
      await post({ body: JSON.stringify({ source: 'đ'.repeat(32768) + 'x' }), labId: 'bad' }),
      413,
      'source-too-large',
    );
    expect(data.reads).toBe(0);
  });
  it.each(['invalid', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])(
    'hides invalid or unknown lab %s',
    async (labId) => {
      await expectProblem(await post({ labId }), 404, 'lab-not-found');
    },
  );
  it('hides a lab from a non-member', async () => {
    await expectProblem(
      await post({
        headers: {
          Authorization: `Bearer ${token({ sub: '22222222-2222-4222-8222-222222222222' })}`,
        },
      }),
      404,
      'lab-not-found',
    );
  });
  it.each(['not-open', 'closed'])('enforces the %s window', async (state) => {
    if (state === 'not-open') data.lab!.opensAt = new Date(Date.now() + 60000);
    else data.lab!.deadlineAt = new Date(Date.now() - 1);
    await expectProblem(await post(), 409, state === 'closed' ? 'lab-closed' : 'lab-not-open');
  });
  it('replays the original receipt after the deadline and ignores unknown body fields', async () => {
    const first = await post();
    const receipt: unknown = await first.json();
    data.lab!.deadlineAt = new Date(Date.now() - 1);
    const second = await post({ body: '{ "ignored": true, "source": "int main() {}" }' });
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual(receipt);
    expect(second.headers.get('location')).toBe(first.headers.get('location'));
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(data.submissions).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('rejects different source with a live key before checking deadline', async () => {
    await post();
    data.lab!.deadlineAt = new Date(Date.now() - 1);
    const response = await post({ body: JSON.stringify({ source: 'changed' }) });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      type: 'https://leetkob.example/problems/idempotency-key-reused',
    });
    expect(data.submissions).toHaveLength(1);
  });
  it('creates a new submission when the key has expired', async () => {
    await post();
    for (const record of data.records.values()) record.expiresAt = new Date(0);
    expect((await post({ body: JSON.stringify({ source: 'changed' }) })).status).toBe(202);
    expect(data.submissions).toHaveLength(2);
  });
  it('keeps idempotency keys case-sensitive', async () => {
    await post();
    expect((await post({ headers: { 'Idempotency-Key': 'SUBMISSION-KEY' } })).status).toBe(202);
    expect(data.submissions).toHaveLength(2);
  });
  it('resolves simultaneous matching requests through the atomic insert result', async () => {
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    expect(data.submissions).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('resolves simultaneous different source to one create and one conflict', async () => {
    const responses = await Promise.all([
      post(),
      post({ body: JSON.stringify({ source: 'changed' }) }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 422]);
    expect(data.submissions).toHaveLength(1);
  });
  it('still returns 202 and preserves replay when queueing fails', async () => {
    enqueue.mockRejectedValue(new Error('Private queue connection detail.'));
    const first = await post();
    expect(first.status).toBe(202);
    const second = await post();
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual(await first.json());
    expect(data.submissions).toHaveLength(1);
  });
  it('hides internal errors and allows a retry with the same key', async () => {
    data.failure = true;
    const result = await expectProblem(await post(), 500, 'internal');
    expect(result.detail).toBe('The request could not be completed.');
    data.failure = false;
    expect((await post()).status).toBe(202);
  });
});

describe('startup configuration', () => {
  it('requires a nonempty secret without exposing it', () => {
    expect(() => validateConfig({})).toThrow('JWT_SECRET is required.');
    expect(() => validateConfig({ JWT_SECRET: ' ' })).toThrow('JWT_SECRET is required.');
  });
  it.each(['0', '65536', '3.5', 'invalid', ''])('rejects invalid port %s', (PORT) => {
    expect(() => validateConfig({ JWT_SECRET: signingMaterial, PORT })).toThrow(
      'PORT must be an integer',
    );
  });
  it('defaults to port 3000', () => {
    expect(validateConfig({ JWT_SECRET: signingMaterial }).port).toBe(3000);
  });
});
