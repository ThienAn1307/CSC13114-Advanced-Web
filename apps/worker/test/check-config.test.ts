import { describe, expect, it } from 'vitest';
import { checkConfig } from '../src/check-config.js';

const ENV = {
  DATABASE_URL: 'postgresql://postgres@localhost:5432/leetkob',
  GEMINI_API_KEY: 'fake-key',
};

describe('checkConfig', () => {
  it('reads the key, with the model of D8 and a cap by default', () => {
    expect(checkConfig(ENV)).toEqual({
      databaseUrl: ENV.DATABASE_URL,
      gemini: { apiKey: 'fake-key', model: 'gemini-3.1-flash-lite' },
      maxCallsPerLab: 200,
    });
  });

  it('needs no key with MODEL_OFF=1, and then ignores one', () => {
    expect(checkConfig({ ...ENV, MODEL_OFF: '1' }).gemini).toBeNull();
    expect(checkConfig({ DATABASE_URL: ENV.DATABASE_URL, MODEL_OFF: '1' }).gemini).toBeNull();
  });

  it('refuses to start without a key', () => {
    expect(() => checkConfig({ ...ENV, GEMINI_API_KEY: '' })).toThrow('GEMINI_API_KEY');
  });

  // D12: the process that holds the key has no access to Docker.
  it('refuses to start with DOCKER_HOST set', () => {
    expect(() => checkConfig({ ...ENV, DOCKER_HOST: 'unix:///x' })).toThrow('DOCKER_HOST');
  });

  it.each(['0', '-1', '1.5', 'many', ''])('refuses the cap %j', (cap) => {
    expect(() => checkConfig({ ...ENV, MAX_MODEL_CALLS_PER_LAB: cap })).toThrow(
      'MAX_MODEL_CALLS_PER_LAB',
    );
  });

  it('reads the cap', () => {
    expect(checkConfig({ ...ENV, MAX_MODEL_CALLS_PER_LAB: '40' }).maxCallsPerLab).toBe(40);
  });
});
