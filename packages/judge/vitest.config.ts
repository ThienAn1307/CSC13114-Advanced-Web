import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'judge', include: ['src/**/*.test.ts'] } });
