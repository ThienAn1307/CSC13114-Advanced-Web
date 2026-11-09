import { defineConfig } from 'vitest/config';

// One `npm test` runs every workspace. A workspace that needs its own setup
// (for example apps/api with SWC for NestJS decorators) adds a vitest.config.ts in its folder.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
