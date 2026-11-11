/**
 * Request builders and assertions taken from docs/contract/post-lab-submissions.md.
 * Every request body is a Buffer sent byte-for-byte: `submit()` turns off superagent's serializer,
 * which would otherwise JSON-encode a Buffer sent as application/json ({"type":"Buffer",...}).
 */
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterEach, beforeEach, expect } from 'vitest';
import { startHarness } from './hooks.js';
import type { Harness } from './hooks.js';

/** Section 2: every `type` is this base followed by a slug. */
export const PROBLEM_BASE = 'https://leetkob.example/problems/';

/** Section 2: the slug, status and title of every error type. */
export const PROBLEMS = {
  'malformed-json': { status: 400, title: 'Malformed JSON' },
  'idempotency-key-missing': { status: 400, title: 'Idempotency-Key required' },
  'idempotency-key-invalid': { status: 400, title: 'Invalid Idempotency-Key' },
  unauthenticated: { status: 401, title: 'Authentication required' },
  'forbidden-role': { status: 403, title: 'Role not allowed' },
  'lab-not-found': { status: 404, title: 'Lab not found' },
  'lab-not-open': { status: 409, title: 'Lab not open yet' },
  'lab-closed': { status: 409, title: 'Lab closed' },
  'source-too-large': { status: 413, title: 'Source too large' },
  'unsupported-media-type': { status: 415, title: 'Unsupported media type' },
  'idempotency-key-reused': { status: 422, title: 'Idempotency-Key reused' },
  'validation-failed': { status: 422, title: 'Invalid request body' },
  internal: { status: 500, title: 'Internal error' },
} as const;

export type Slug = keyof typeof PROBLEMS;

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: { pointer: string; detail: string }[];
}

export interface Receipt {
  id: string;
  labId: string;
  status: string;
  receivedAt: string;
  sizeBytes: number;
}

export const SOURCE = '#include <iostream>\nint main() { std::cout << 42; }\n';
export const MAX_SOURCE_BYTES = 65_536;
export const MAX_BODY_BYTES = 262_144;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Section 2: `detail` never shows a stack trace, a file path or a library name. */
const INTERNALS =
  /\bat \S+ \(|\.(ts|js|mjs):\d+|node_modules|[A-Za-z]:\\|\/(usr|home|app|src)\/|\b(drizzle|postgres|postgresql|nestjs|express|body-parser|passport|jsonwebtoken|bullmq|class-validator|ioredis)\b/i;
/** Section 2: `detail` never shows an SQL message or a table name. */
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b|\b(submissions|idempotency_keys|class_members)\b/;

/** One fresh harness (seeded database, app, clock, queue) per test. */
export function useHarness(): () => Harness {
  let current: Harness | undefined;
  beforeEach(async () => {
    current = await startHarness();
  });
  afterEach(async () => {
    await current?.close();
    current = undefined;
  });
  return () => {
    if (!current) throw new Error('harness not started');
    return current;
  };
}

/**
 * superagent's serializer, replaced so the Buffer goes on the wire unchanged (its Node code sends a
 * Buffer as is and sets Content-Length from its byte length). The type says string; a Buffer works.
 */
const sendBytesUnchanged = ((body: Buffer) => body) as unknown as (body: unknown) => string;

export function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

export function raw(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function newKey(): string {
  return randomUUID();
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export interface TokenOptions {
  /** The user id; `null` leaves the claim out. */
  sub: string | null;
  /** `null` leaves the claim out. */
  role: string | null;
  /** Seconds from the real current time; `null` leaves `exp` out. Default: 30 days. */
  expiresIn?: number | null;
  alg?: 'HS256' | 'HS512' | 'none';
  extraClaims?: Record<string, unknown>;
}

/** Builds a token signed with the test-only secret that vitest.config.ts puts in JWT_SECRET. */
export async function signTestToken(options: TokenOptions): Promise<string> {
  const { sub, role, expiresIn = 30 * 24 * 3600, alg = 'HS256', extraClaims = {} } = options;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { ...extraClaims, iat: nowSeconds };
  if (sub !== null) claims.sub = sub;
  if (role !== null) claims.role = role;
  if (expiresIn !== null) claims.exp = nowSeconds + expiresIn;
  if (alg === 'none') {
    // Built by hand: an unsigned token with an empty signature part.
    return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(claims)}.`;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set by vitest.config.ts');
  return new SignJWT(claims)
    .setProtectedHeader({ alg, typ: 'JWT' })
    .sign(new TextEncoder().encode(secret));
}

/** Keeps the header and claims of a valid token and replaces its signature by hand. */
export function withBadSignature(token: string): string {
  const [header, payload] = token.split('.');
  return `${header}.${payload}.${Buffer.alloc(32, 7).toString('base64url')}`;
}

export interface SubmitOptions {
  labId: string;
  /** A user id to sign a token for; default `seed.users.stu1`. */
  as?: string;
  /** Role claim for `as`; default `student`. */
  role?: string;
  /** The whole Authorization header; `null` sends none. Overrides `as` and `role`. */
  authorization?: string | null;
  /** `undefined`: a fresh key. `null`: no Idempotency-Key header. */
  key?: string | null;
  /** `undefined`: `application/json`. `null`: no Content-Type header. */
  contentType?: string | null;
  /** Default: `{ "source": SOURCE }`. */
  body?: Buffer;
}

/** POST /v1/labs/{labId}/submissions with full control over every header and every byte. */
export async function submit(h: Harness, options: SubmitOptions): Promise<Response> {
  const authorization =
    options.authorization === undefined
      ? `Bearer ${await signTestToken({ sub: options.as ?? h.seed.users.stu1, role: options.role ?? 'student' })}`
      : options.authorization;
  const key = options.key === undefined ? newKey() : options.key;
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;

  let req = request(h.server).post(`/v1/labs/${options.labId}/submissions`);
  if (authorization !== null) req = req.set('Authorization', authorization);
  if (key !== null) req = req.set('Idempotency-Key', key);
  if (contentType !== null) req = req.set('Content-Type', contentType);
  return req.serialize(sendBytesUnchanged).send(options.body ?? json({ source: SOURCE }));
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

/** Section 2: status, media type, `type`, `title`, `status` member, and a `detail` with no internals. */
export function expectProblem(res: Response, slug: Slug): Problem {
  const { status, title } = PROBLEMS[slug];
  expect(res.status).toBe(status);
  expect(res.get('Content-Type')).toMatch(/^application\/problem\+json\b/);
  const problem = res.body as Problem;
  expect(problem.type).toBe(PROBLEM_BASE + slug);
  expect(problem.title).toBe(title);
  expect(problem.status).toBe(status);
  expect(typeof problem.detail).toBe('string');
  expect(problem.detail).not.toMatch(INTERNALS);
  expect(problem.detail).not.toMatch(SQL);
  if (slug !== 'validation-failed') expect(problem).not.toHaveProperty('errors');
  return problem;
}

/** Section 1: a 401 also carries `WWW-Authenticate: Bearer`. */
export function expectUnauthenticated(res: Response): Problem {
  const problem = expectProblem(res, 'unauthenticated');
  expect(res.get('WWW-Authenticate')).toMatch(/^Bearer\b/);
  return problem;
}

/** Section 2: `validation-failed` lists every broken field in `errors`, each with pointer and detail. */
export function expectValidationFailed(res: Response, pointer: string): Problem {
  const problem = expectProblem(res, 'validation-failed');
  expect(Array.isArray(problem.errors)).toBe(true);
  const errors = problem.errors ?? [];
  expect(errors.length).toBeGreaterThan(0);
  for (const error of errors) {
    expect(typeof error.pointer).toBe('string');
    expect(typeof error.detail).toBe('string');
  }
  expect(errors.map((error) => error.pointer)).toContain(pointer);
  return problem;
}

/** Sections 3 and 4.3: a 202 with `Location` and a well-formed receipt for this lab. */
export function expectAccepted(res: Response, labId: string): Receipt {
  expect(res.status).toBe(202);
  expect(res.get('Content-Type')).toMatch(/^application\/json\b/);
  const receipt = res.body as Receipt;
  expect(receipt.id).toMatch(UUID);
  expect(receipt.labId).toBe(labId.toLowerCase());
  expect(receipt.status).toBe('queued');
  expect(receipt.receivedAt).toMatch(ISO_UTC_MS);
  expect(Number.isInteger(receipt.sizeBytes)).toBe(true);
  expect(receipt.sizeBytes).toBeGreaterThanOrEqual(1);
  expect(receipt.sizeBytes).toBeLessThanOrEqual(MAX_SOURCE_BYTES);
  expect(res.get('Location')).toBe(`/v1/submissions/${receipt.id}`);
  return receipt;
}

export function isReplay(res: Response): boolean {
  return res.get('Idempotent-Replayed') === 'true';
}
