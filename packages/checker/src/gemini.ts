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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function geminiModel(options: GeminiOptions): Model {
  const fetch = options.fetch ?? globalThis.fetch;
  const minIntervalMs = options.minIntervalMs ?? 4500;
  let lastCallAt = -Infinity;

  return {
    name: options.model,
    async complete({ prompt, signal }): Promise<ModelResponse> {
      const wait = lastCallAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();

      const response = await fetch(`${ENDPOINT}/${options.model}:generateContent`, {
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
      const body = (await response.json().catch(() => ({}))) as GenerateContentResponse;
      if (!response.ok) {
        throw new Error(`Gemini HTTP ${response.status}: ${body.error?.message ?? 'no message'}`);
      }

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
    },
  };
}
