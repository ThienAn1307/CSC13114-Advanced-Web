/**
 * Size limit for a submitted C++ source (FAQ-05: 64 KB; decisions.md D6: counted in UTF-8 bytes).
 * Assumption: 64 KB = 64 x 1024 bytes. The HTTP contract must state the same number.
 */
export const MAX_SOURCE_BYTES = 64 * 1024;

/** Size of the source as the judge will store it: UTF-8 bytes, not JavaScript string length. */
export function sourceSizeBytes(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

export function isSourceTooLarge(source: string): boolean {
  return sourceSizeBytes(source) > MAX_SOURCE_BYTES;
}
