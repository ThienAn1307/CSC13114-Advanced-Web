import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { FakeSubmissionData, STUDENT_ID } from './fake-submission-data.js';

const signingMaterial = randomBytes(32).toString('hex');
let app: NestExpressApplication;
let origin: string;

beforeAll(async () => {
  const passwordHash = await hashPassword('correct horse');
  app = await createApp({
    config: { jwtSecret: signingMaterial, port: 3000 },
    data: new FakeSubmissionData(),
    queue: { enqueue: () => Promise.resolve() },
    accounts: {
      findByEmail: (email) =>
        Promise.resolve(
          email === 'student@example.test'
            ? { id: STUDENT_ID, role: 'student', passwordHash }
            : null,
        ),
    },
  });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});

async function login(email: string, password: string): Promise<Response> {
  return fetch(`${origin}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('login', () => {
  it('issues a bearer token accepted by the existing student guard', async () => {
    const response = await login('student@example.test', 'correct horse');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accessToken: string };
    const protectedResponse = await fetch(`${origin}/v1/labs/not-a-uuid/submissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${body.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test',
      },
      body: JSON.stringify({ source: 'int main() {}' }),
    });
    expect(protectedResponse.status).toBe(404);
  });

  it('rejects wrong credentials without distinguishing missing users', async () => {
    const missing = await login('missing@example.test', 'wrong');
    const wrong = await login('student@example.test', 'wrong');
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await missing.json()).toEqual(await wrong.json());
  });
});
