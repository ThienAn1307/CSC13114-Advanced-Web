import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// The database tests read DATABASE_URL, which the README (Checks) tells a developer to put in .env.
// Only that variable is taken from .env, and only when it is not set already (CI's job env).
// The model keys are removed wherever they came from, so a test that forgets its fake model cannot
// reach Gemini. This holds for every test run through this config (`npm test`, `npm run check`);
// a workspace's own vitest.config.ts run on its own does not do it.
const envFile = join(import.meta.dirname, '.env');
if (existsSync(envFile) && process.env.DATABASE_URL === undefined) {
  const { DATABASE_URL } = parseEnv(readFileSync(envFile, 'utf8'));
  if (DATABASE_URL !== undefined) process.env.DATABASE_URL = DATABASE_URL;
}
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

// One `npm test` runs every workspace. A workspace that needs its own setup
// (for example apps/api with SWC for NestJS decorators) adds a vitest.config.ts in its folder.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tests/*'],
  },
});
