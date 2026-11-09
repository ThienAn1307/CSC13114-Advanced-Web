import { defineConfig } from 'vitest/config';

// Contract tests for POST /v1/labs/{labId}/submissions, written from
// docs/contract/post-lab-submissions.md only, never from the endpoint's code (decisions.md D10).
export default defineConfig({
  test: {
    name: 'contract',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Throws when DATABASE_URL is missing: a database test fails, it never skips (README, Checks).
    globalSetup: ['src/global-setup.ts'],
    // Every test resets and seeds the same database, so test files run one at a time.
    fileParallelism: false,
    env: {
      // Test-only signing secret for the tokens the tests build; never read from .env (AGENTS.md).
      JWT_SECRET: 'contract-tests-only-signing-secret',
    },
  },
});
