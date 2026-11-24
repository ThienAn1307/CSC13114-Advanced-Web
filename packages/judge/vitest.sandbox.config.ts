import { defineConfig } from 'vitest/config';

// This standalone Docker suite has the same no-model-key protection as the root test runner.
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

export default defineConfig({
  test: {
    include: ['packages/judge/sandbox/**/*.test.ts'],
    testTimeout: 120000,
    fileParallelism: false,
  },
});
