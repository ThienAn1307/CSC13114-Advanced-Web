import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ jsc: { transform: { decoratorMetadata: true } } })],
  test: {
    name: 'api',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Same as packages/db/vitest.config.ts: the PostgreSQL tests create and migrate a database.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
