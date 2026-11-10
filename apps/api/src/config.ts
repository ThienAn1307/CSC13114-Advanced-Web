export interface ApiConfig {
  jwtSecret: string;
  port: number;
}

/** Reads only the supplied environment; invalid values are never echoed. */
export function validateConfig(env: NodeJS.ProcessEnv): ApiConfig {
  if (!env.JWT_SECRET?.trim()) throw new Error('JWT_SECRET is required.');
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return { jwtSecret: env.JWT_SECRET, port };
}

export const API_CONFIG = Symbol('API_CONFIG');
