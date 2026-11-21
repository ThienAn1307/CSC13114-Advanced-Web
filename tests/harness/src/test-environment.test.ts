import { describe, expect, it } from 'vitest';

describe('the test environment', () => {
  it('has no GEMINI_API_KEY, even when the shell that runs npm test has one', () => {
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });
});
