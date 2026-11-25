import { requireDatabaseUrl } from '../../../packages/db/src/client.js';

export interface CheckConfig {
  databaseUrl: string;
  /** Null with MODEL_OFF=1: no client is created and no connection is opened. */
  gemini: { apiKey: string; model: string } | null;
  maxCallsPerLab: number;
}

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'; // decisions.md D8
/** 80 submissions with 2 semantic constraints are 160 calls; the free tier has 500 a day (D8). */
const DEFAULT_CAP = '200';

/** Checked at startup; no message repeats a value. */
export function checkConfig(env: NodeJS.ProcessEnv): CheckConfig {
  // D12: the process that holds the model key has no access to Docker.
  if (env.DOCKER_HOST !== undefined) throw new Error('The check worker must not have DOCKER_HOST.');
  const cap = env.MAX_MODEL_CALLS_PER_LAB ?? DEFAULT_CAP;
  if (!/^[1-9]\d{0,5}$/.test(cap)) {
    throw new Error('MAX_MODEL_CALLS_PER_LAB must be a whole number above 0.');
  }
  let gemini: CheckConfig['gemini'] = null;
  if (env.MODEL_OFF !== '1') {
    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY is required, or set MODEL_OFF=1.');
    gemini = { apiKey, model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL };
  }
  return { databaseUrl: requireDatabaseUrl(env), gemini, maxCallsPerLab: Number(cap) };
}
