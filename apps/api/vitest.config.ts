import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ jsc: { transform: { decoratorMetadata: true } } })],
  test: { name: 'api', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
