import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const devSet = join(repoRoot, 'eval', 'dev');
const manifest = join(repoRoot, 'eval', 'dev.sha256');

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

function readManifest(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of readFileSync(manifest, 'utf8').split('\n')) {
    if (line === '') continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) throw new Error(`bad line in eval/dev.sha256: ${line}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

describe('the dev set in eval/dev', () => {
  it('has the eval.mjs and labels.jsonl that the PA#3 rubric names by their SHA-256', () => {
    expect(sha256(join(devSet, 'eval.mjs'))).toMatch(/^c836edd8713521bb/);
    expect(sha256(join(devSet, 'labels.jsonl'))).toMatch(/^262cda7b0ef5612e/);
  });

  it('matches the published copy file by file, with no file added or missing', () => {
    const expected = readManifest();
    expect(filesUnder(devSet)).toEqual([...expected.keys()].sort());
    for (const [path, hash] of expected) {
      expect(sha256(join(devSet, path)), path).toBe(hash);
    }
  });
});
