export interface ApiConfig {
  jwtSecret: string;
  port: number;
}

/** Reads only the supplied environment; invalid values are never echoed. */
export function validateConfig(env: NodeJS.ProcessEnv): ApiConfig {
  if (!env.JWT_SECRET?.trim()) throw new Error('JWT_SECRET is required.');
  // A blank PORT (`.env.example` ships `PORT=`) means unset, so the default applies.
  const rawPort = env.PORT?.trim();
  const port = rawPort ? Number(rawPort) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return { jwtSecret: env.JWT_SECRET, port };
}

export const API_CONFIG = Symbol('API_CONFIG');
