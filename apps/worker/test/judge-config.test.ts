import { describe, expect, it } from 'vitest';
import { judgeConfig } from '../src/judge-config.js';

const ENV = {
  DATABASE_URL: 'postgresql://postgres@localhost:5432/leetkob',
  JUDGE_IMAGE: `sha256:${'a'.repeat(64)}`,
};

describe('judgeConfig', () => {
  it('reads the database and the image', () => {
    expect(judgeConfig(ENV)).toEqual({ databaseUrl: ENV.DATABASE_URL, image: ENV.JUDGE_IMAGE });
  });

  // D12: the process that starts sandboxes never holds the model key.
  it.each(['GEMINI_API_KEY', 'GOOGLE_API_KEY'])('refuses to start with %s set', (name) => {
    expect(() => judgeConfig({ ...ENV, [name]: 'secret-value' })).toThrow(name);
    expect(() => judgeConfig({ ...ENV, [name]: 'secret-value' })).not.toThrow('secret-value');
  });

  it.each([undefined, '', 'judge-cpp:latest', 'sha256:abc'])('refuses the image %s', (image) => {
    expect(() => judgeConfig({ ...ENV, JUDGE_IMAGE: image })).toThrow('JUDGE_IMAGE');
  });

  it('refuses to start without a database', () => {
    expect(() => judgeConfig({ ...ENV, DATABASE_URL: ' ' })).toThrow('DATABASE_URL');
  });
});
