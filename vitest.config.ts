import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// The database tests read DATABASE_URL, which the README (Checks) tells a developer to put in .env.
// Load the repo's .env when it exists; a variable already set (CI's job env) is not overridden.
const envFile = join(import.meta.dirname, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// One `npm test` runs every workspace. A workspace that needs its own setup
// (for example apps/api with SWC for NestJS decorators) adds a vitest.config.ts in its folder.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tests/*'],
  },
});
