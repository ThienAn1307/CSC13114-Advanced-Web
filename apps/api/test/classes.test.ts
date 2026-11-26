import { createHmac, randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { FakeSubmissionData, STUDENT_ID } from './fake-submission-data.js';

const secret = randomBytes(32).toString('hex');
const createClass = vi.fn((code: string, name: string) =>
  Promise.resolve({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    code,
    name,
  }),
);
const listClasses = vi.fn(() => Promise.resolve([]));
let app: NestExpressApplication;
let origin: string;

function token(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: STUDENT_ID, role, exp: Math.floor(Date.now() / 1000) + 60 }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

beforeAll(async () => {
  app = await createApp({
    config: { jwtSecret: secret, port: 3000 },
    data: new FakeSubmissionData(),
    queue: { enqueue: () => Promise.resolve() },
    classrooms: { createClass, listClasses },
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});

describe('class management', () => {
  it('allows an admin to create a class', async () => {
    const response = await fetch(`${origin}/v1/classes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token('admin')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'C1', name: 'Class one' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ code: 'C1', name: 'Class one' });
  });

  it('prevents students and TAs from creating classes', async () => {
    createClass.mockClear();
    for (const role of ['student', 'ta']) {
      const response = await fetch(`${origin}/v1/classes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token(role)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'C1', name: 'Class one' }),
      });
      expect(response.status).toBe(403);
    }
    expect(createClass).not.toHaveBeenCalled();
  });

  it('passes the caller identity and role to class listing', async () => {
    const response = await fetch(`${origin}/v1/classes`, {
      headers: { Authorization: `Bearer ${token('student')}` },
    });
    expect(response.status).toBe(200);
    expect(listClasses).toHaveBeenCalledWith({ id: STUDENT_ID, role: 'student' });
  });
});
