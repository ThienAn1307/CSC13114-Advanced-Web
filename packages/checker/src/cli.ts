// npm run checker -- --data <folder> --out <file.jsonl>
// Runs on plain Node 24 (it strips the types), so the Docker image needs no build step.

import { parseArgs } from 'node:util';
import { writePredictions } from './predict.ts';

const USAGE =
  'usage: MODEL_OFF=1 npm run checker -- --data <dataset folder> --out <predictions.jsonl>';

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

let values: { data?: string; out?: string };
try {
  ({ values } = parseArgs({ options: { data: { type: 'string' }, out: { type: 'string' } } }));
} catch (error) {
  fail((error as Error).message);
}
if (!values.data) fail('--data is missing');
if (!values.out) fail('--out is missing');

const modelOff = process.env.MODEL_OFF === '1';
if (!modelOff) fail('only MODEL_OFF=1 is built so far: the model path comes next');

await writePredictions({ data: values.data, out: values.out, modelOff });
console.log(`wrote ${values.out}`);
