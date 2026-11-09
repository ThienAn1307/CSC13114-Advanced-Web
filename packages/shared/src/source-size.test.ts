import { describe, expect, it } from 'vitest';
import { MAX_SOURCE_BYTES, isSourceTooLarge, sourceSizeBytes } from './source-size.js';

describe('sourceSizeBytes', () => {
  it('counts ASCII as one byte per character', () => {
    expect(sourceSizeBytes('int main(){}')).toBe(12);
  });

  it('counts Vietnamese letters as UTF-8 bytes, not characters', () => {
    // "đ" is 2 bytes, "ể" is 3 bytes in UTF-8
    expect('// đểm'.length).toBe(6);
    expect(sourceSizeBytes('// đểm')).toBe(9);
  });

  it('counts an emoji as 4 bytes although JavaScript sees 2 code units', () => {
    expect('😀'.length).toBe(2);
    expect(sourceSizeBytes('😀')).toBe(4);
  });
});

describe('isSourceTooLarge', () => {
  it('accepts a source of exactly the limit', () => {
    expect(isSourceTooLarge('a'.repeat(MAX_SOURCE_BYTES))).toBe(false);
  });

  it('rejects one byte over the limit', () => {
    expect(isSourceTooLarge('a'.repeat(MAX_SOURCE_BYTES + 1))).toBe(true);
  });

  it('rejects a source under the limit in characters but over it in bytes', () => {
    const source = 'đ'.repeat(MAX_SOURCE_BYTES / 2 + 1); // 32,769 characters, 65,538 bytes
    expect(source.length).toBeLessThan(MAX_SOURCE_BYTES);
    expect(isSourceTooLarge(source)).toBe(true);
  });
});
