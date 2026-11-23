// The Gemini client (D8, D14) against a fake fetch: these tests never reach the network.
// The response shape is the one a real call returned on 2026-11-23 (responseId, modelVersion,
// usageMetadata, candidates[].content.parts[].text).

import { describe, expect, it } from 'vitest';
import { check } from '../src/check.ts';
import { geminiModel } from '../src/gemini.ts';

const API_KEY = 'fake-key-for-tests';
const MODEL = 'gemini-3.1-flash-lite';
const ANSWER = JSON.stringify({ verdict: 'pass', evidence: [], reason: 'ok' });

interface Sent {
  url: string;
  init: RequestInit;
  at: number;
}

function fakeFetch(reply: (n: number) => Response) {
  const sent: Sent[] = [];
  const fetch = (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: url instanceof Request ? url.url : url.toString(),
      init: init ?? {},
      at: Date.now(),
    });
    return Promise.resolve(reply(sent.length));
  };
  return { fetch, sent };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const answered = (text = ANSWER) =>
  ok({
    candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: {
      promptTokenCount: 120,
      candidatesTokenCount: 30,
      thoughtsTokenCount: 5,
      totalTokenCount: 155,
    },
    modelVersion: MODEL,
    responseId: 'resp-abc',
  });

const client = (fetch: typeof globalThis.fetch, minIntervalMs = 0) =>
  geminiModel({ apiKey: API_KEY, model: MODEL, fetch, minIntervalMs });

describe('the request', () => {
  it('posts the prompt to generateContent with the key in a header and a JSON schema', async () => {
    const { fetch, sent } = fakeFetch(() => answered());
    const signal = new AbortController().signal;
    await client(fetch).complete({ prompt: 'PROMPT TEXT', signal });

    expect(sent).toHaveLength(1);
    const [{ url, init }] = sent as [Sent];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    );
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe(API_KEY);
    expect(init.signal).toBe(signal);
    const body = JSON.parse(init.body as string) as {
      contents: { parts: { text: string }[] }[];
      generationConfig: { responseMimeType: string; responseJsonSchema: { required: string[] } };
    };
    expect(body.contents[0]?.parts[0]?.text).toBe('PROMPT TEXT');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema.required).toEqual([
      'verdict',
      'evidence',
      'reason',
    ]);
  });

  it('never puts the key in the URL or the body', async () => {
    const { fetch, sent } = fakeFetch(() => answered());
    await client(fetch).complete({ prompt: 'p', signal: new AbortController().signal });
    expect(sent[0]?.url).not.toContain(API_KEY);
    expect(sent[0]?.init.body as string).not.toContain(API_KEY);
  });

  it('waits minIntervalMs between two calls, to stay under the free-tier rate (15 per minute)', async () => {
    const { fetch, sent } = fakeFetch(() => answered());
    const model = client(fetch, 150);
    const signal = new AbortController().signal;
    await model.complete({ prompt: 'a', signal });
    await model.complete({ prompt: 'b', signal });
    expect(sent[1]!.at - sent[0]!.at).toBeGreaterThanOrEqual(140);
  });
});

describe('the response', () => {
  it('gives the text, the provider request id, the model version and the tokens', async () => {
    const { fetch } = fakeFetch(() => answered());
    const response = await client(fetch).complete({
      prompt: 'p',
      signal: new AbortController().signal,
    });
    expect(response).toEqual({
      text: ANSWER,
      requestId: 'resp-abc',
      model: MODEL,
      tokensIn: 120,
      tokensOut: 35,
      // List price on 2026-11-23: $0.25 and $1.50 per 1M tokens, so 250 and 1500 nano-USD per token.
      costNanoUsd: 120 * 250 + 35 * 1500,
    });
  });

  it('has no cost for a model whose list price we have not checked', async () => {
    const { fetch } = fakeFetch(() => answered());
    const other = geminiModel({
      apiKey: API_KEY,
      model: 'gemini-unpriced',
      fetch,
      minIntervalMs: 0,
    });
    const response = await other.complete({ prompt: 'p', signal: new AbortController().signal });
    expect(response.costNanoUsd).toBeUndefined();
  });

  it('gives empty text when the prompt was blocked and no candidate came back', async () => {
    const { fetch } = fakeFetch(() =>
      ok({
        promptFeedback: { blockReason: 'SAFETY' },
        responseId: 'resp-blocked',
        usageMetadata: { promptTokenCount: 9 },
      }),
    );
    const response = await client(fetch).complete({
      prompt: 'p',
      signal: new AbortController().signal,
    });
    expect(response).toMatchObject({
      text: '',
      requestId: 'resp-blocked',
      tokensIn: 9,
      tokensOut: 0,
    });
  });

  it('rejects on an HTTP error, with the status in the message', async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'Resource exhausted' } }), { status: 429 }),
    );
    await expect(
      client(fetch).complete({ prompt: 'p', signal: new AbortController().signal }),
    ).rejects.toThrow(/429/);
  });
});

describe('check() with the Gemini client', () => {
  const statement = '# Sorting\n';
  const MERGE = { id: 'C2', text: 'Sort with a merge sort you wrote yourself.', deduction: 4 };
  const FREE = { id: 'C3', text: 'Free every block you allocate.', deduction: 1 };
  const source = 'int main() {}\n';

  it('makes a blocked prompt unsure, cause bad-schema, and logs its request id', async () => {
    const { fetch } = fakeFetch(() =>
      ok({ promptFeedback: { blockReason: 'SAFETY' }, responseId: 'resp-blocked' }),
    );
    const result = await check(
      { statement, constraints: [MERGE], source },
      { modelOff: false, model: client(fetch), timeoutMs: 2000 },
    );
    expect(result.verdicts[0]).toMatchObject({ verdict: 'unsure', unsureCause: 'bad-schema' });
    expect(result.calls[0]).toMatchObject({ requestId: 'resp-blocked', outcome: 'bad-schema' });
  });

  it('puts the cost of each call in the call log, as whole nano-USD (PA#3 criterion 4)', async () => {
    const { fetch } = fakeFetch(() => answered());
    const { calls } = await check(
      { statement, constraints: [MERGE], source },
      { modelOff: false, model: client(fetch), timeoutMs: 2000 },
    );
    expect(calls[0]).toMatchObject({ requestId: 'resp-abc', costNanoUsd: 82500 });
    expect(Number.isInteger(calls[0]?.costNanoUsd)).toBe(true);
  });

  it('makes a failed call unsure, cause model-error, and still judges the next constraint (D14)', async () => {
    const { fetch } = fakeFetch((n) =>
      n === 1 ? new Response('{}', { status: 503 }) : answered(),
    );
    const result = await check(
      { statement, constraints: [MERGE, FREE], source },
      { modelOff: false, model: client(fetch), timeoutMs: 2000 },
    );
    expect(result.verdicts.map((v) => [v.constraintId, v.verdict, v.unsureCause])).toEqual([
      ['C2', 'unsure', 'model-error'],
      ['C3', 'pass', undefined],
    ]);
    expect(result.calls.map((c) => c.outcome)).toEqual(['model-error', 'answered']);
  });
});
