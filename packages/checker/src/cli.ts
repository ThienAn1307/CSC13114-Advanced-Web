// npm run checker -- --data <folder> --out <predictions.jsonl> [--calls <calls.jsonl>]
// MODEL_OFF=1: hard rules only; no model client is created and no connection is opened.
// Otherwise GEMINI_API_KEY (and optionally GEMINI_MODEL) come from the environment, never from a file
// this command reads. Runs on plain Node 24 (it strips the types), so the image needs no build step.

import { parseArgs } from 'node:util';
import type { CheckOptions } from './check.ts';
import { geminiModel } from './gemini.ts';
import { writePredictions } from './predict.ts';

const USAGE =
  'usage: [MODEL_OFF=1] npm run checker -- --data <dataset folder> --out <predictions.jsonl> [--calls <calls.jsonl>]';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'; // decisions.md D8
const TIMEOUT_MS = 60_000; // room for two retries (5 s and 10 s) after the rate wait

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

let values: { data?: string; out?: string; calls?: string };
try {
  ({ values } = parseArgs({
    options: { data: { type: 'string' }, out: { type: 'string' }, calls: { type: 'string' } },
  }));
} catch (error) {
  fail((error as Error).message);
}
if (!values.data) fail('--data is missing');
if (!values.out) fail('--out is missing');

let options: CheckOptions;
if (process.env.MODEL_OFF === '1') {
  options = { modelOff: true };
} else {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) fail('GEMINI_API_KEY is not set; set it, or run with MODEL_OFF=1');
  // fetch repeats a header value it cannot send in its error, which the call log keeps: stop here.
  if (!/^[\x21-\x7e]+$/.test(apiKey))
    fail('GEMINI_API_KEY has a space, a line break or another character a key cannot have');
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  options = { modelOff: false, model: geminiModel({ apiKey, model }), timeoutMs: TIMEOUT_MS };
}

await writePredictions({ data: values.data, out: values.out, calls: values.calls, ...options });
console.log(`wrote ${values.out}${values.calls ? ` and ${values.calls}` : ''}`);
