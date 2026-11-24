import { describe, expect, it } from 'vitest';

describe('the test environment', () => {
  it('has no GEMINI_API_KEY, even when the shell that runs npm test has one', () => {
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it('has no GOOGLE_API_KEY, which Google client libraries also read', () => {
    expect(process.env.GOOGLE_API_KEY).toBeUndefined();
  });
});
