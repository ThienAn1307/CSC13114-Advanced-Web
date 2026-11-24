import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'checker',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
