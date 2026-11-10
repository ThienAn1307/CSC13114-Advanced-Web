import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// CI sets DATABASE_URL; locally it comes from the repo's .env (README, Checks).
// A value already in the environment wins, and nothing but DATABASE_URL is taken from the file.
function databaseUrl(): Record<string, string> {
  if (process.env.DATABASE_URL) return {};
  const file = new URL('../../.env', import.meta.url);
  if (!existsSync(file)) return {};
  const value = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL;
  return value ? { DATABASE_URL: value } : {};
}

export default defineConfig({
  test: {
    name: 'db',
    include: ['test/**/*.test.ts'],
    env: databaseUrl(),
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
