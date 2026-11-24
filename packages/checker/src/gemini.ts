// The Gemini client (D8, D14): one REST call per prompt, no SDK. The request and response shape
// were checked with a real call on 2026-11-23 (generateContent, x-goog-api-key, responseJsonSchema).

import type { Model, ModelResponse } from './model.ts';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Injected in tests; the real one by default. */
  fetch?: typeof globalThis.fetch;
  /** Minimum time between two calls. 4500 ms keeps under the free tier's 15 requests per minute. */
  minIntervalMs?: number;
  /** One retry per entry, after that many ms, for HTTP 429 and 503 only. Default: 5 s, then 10 s. */
  retryDelaysMs?: number[];
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Paid list price in nano-USD per token, which is the same number as USD per 1M tokens times 1000.
 * Read on Google's pricing page on 2026-11-23. The free tier is billed $0; this is what a call would cost.
 */
const NANO_USD_PER_TOKEN: Record<string, { input: number; output: number }> = {
  'gemini-3.1-flash-lite': { input: 250, output: 1500 },
};

/** The answer schema (D14), sent so the model answers in JSON; our own check still decides. */
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'violation', 'unsure'] },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: { line: { type: 'integer' }, text: { type: 'string' } },
        required: ['line', 'text'],
      },
    },
    reason: { type: 'string' },
  },
  required: ['verdict', 'evidence', 'reason'],
};

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
  responseId?: string;
  error?: { message?: string };
}

/** HTTP statuses that mean "not now" (rate limit, high demand), worth one more try. */
const RETRYABLE = new Set([429, 503]);

/** Waits ms, or rejects as soon as the call is aborted, so a wait never outlives the time limit. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

export function geminiModel(options: GeminiOptions): Model {
  const fetch = options.fetch ?? globalThis.fetch;
  const minIntervalMs = options.minIntervalMs ?? 4500;
  const retryDelaysMs = options.retryDelaysMs ?? [5000, 10000];
  let nextSlotAt = -Infinity;

  return {
    name: options.model,
    async complete({ prompt, signal }): Promise<ModelResponse> {
      for (let attempt = 0; ; attempt++) {
        // The slot is taken before any await, so two calls at the same time never get the same one.
        const now = Date.now();
        const slotAt = Math.max(now, nextSlotAt);
        nextSlotAt = slotAt + minIntervalMs;
        if (slotAt > now) await pause(slotAt - now, signal);
        const response = await post(prompt, signal);
        const body = (await response.json().catch((error: unknown) => {
          // A 200 we cannot read is a failed call; an error status says enough without its body.
          if (response.ok) throw error;
          return {};
        })) as GenerateContentResponse;
        if (response.ok) return answer(body);
        const error = new Error(
          `Gemini HTTP ${response.status}: ${body.error?.message ?? 'no message'}`,
        );
        const delay = retryDelaysMs[attempt];
        if (!RETRYABLE.has(response.status) || delay === undefined) throw error;
        await pause(delay, signal);
      }
    },
  };

  function post(prompt: string, signal: AbortSignal): Promise<Response> {
    return fetch(`${ENDPOINT}/${options.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: ANSWER_SCHEMA,
        },
      }),
      signal,
    });
  }

  function answer(body: GenerateContentResponse): ModelResponse {
    // A blocked prompt has no candidate: the empty text is not the schema, so it becomes unsure.
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const usage = body.usageMetadata ?? {};
    const tokensIn = usage.promptTokenCount ?? 0;
    const tokensOut = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    const price = NANO_USD_PER_TOKEN[options.model];
    return {
      text: parts.map((part) => part.text ?? '').join(''),
      requestId: body.responseId ?? '',
      model: body.modelVersion ?? options.model,
      tokensIn,
      tokensOut,
      costNanoUsd: price && tokensIn * price.input + tokensOut * price.output,
    };
  }
}
