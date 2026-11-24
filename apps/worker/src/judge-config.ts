import { requireDatabaseUrl } from '../../../packages/db/src/client.js';

export interface JudgeConfig {
  databaseUrl: string;
  /** The sandbox image by its immutable id (D19). */
  image: string;
}

const MODEL_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];
const PINNED_IMAGE = /^(?:[A-Za-z0-9._/:-]+@)?sha256:[0-9a-f]{64}$/;

/** Checked at startup; no message repeats a value. */
export function judgeConfig(env: NodeJS.ProcessEnv): JudgeConfig {
  // D12: the process that starts sandboxes never holds the model key, so it cannot pass it on.
  for (const name of MODEL_KEYS) {
    if (env[name] !== undefined) throw new Error(`The judge worker must not have ${name}.`);
  }
  const image = env.JUDGE_IMAGE ?? '';
  if (!PINNED_IMAGE.test(image)) throw new Error('JUDGE_IMAGE must be an image pinned by sha256.');
  return { databaseUrl: requireDatabaseUrl(env), image };
}
