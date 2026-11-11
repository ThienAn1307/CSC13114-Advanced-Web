import { describe, expect, it } from 'vitest';
import {
  expectAccepted,
  expectProblem,
  expectValidationFailed,
  json,
  MAX_BODY_BYTES,
  MAX_SOURCE_BYTES,
  raw,
  SOURCE,
  submit,
  useHarness,
  utf8Bytes,
} from './helpers.js';

describe('section 4.2: request', () => {
  const h = useHarness();
  const lab = () => h().seed.labs.class1Open;

  describe('Content-Type header', () => {
    it('4.2: Content-Type text/plain gets 415 unsupported-media-type', async () => {
      const res = await submit(h(), { labId: lab(), contentType: 'text/plain' });
      expectProblem(res, 'unsupported-media-type');
    });

    it('4.2: no Content-Type header gets 415 unsupported-media-type', async () => {
      const res = await submit(h(), { labId: lab(), contentType: null });
      expectProblem(res, 'unsupported-media-type');
    });

    it('4.2: application/json with a charset other than utf-8 gets 415 unsupported-media-type', async () => {
      const res = await submit(h(), {
        labId: lab(),
        contentType: 'application/json; charset=latin1',
      });
      expectProblem(res, 'unsupported-media-type');
    });

    it('4.2: application/json; charset=utf-8 is accepted', async () => {
      const res = await submit(h(), {
        labId: lab(),
        contentType: 'application/json; charset=utf-8',
      });
      expectAccepted(res, lab());
    });

    it('4.2: media type and charset are compared case-insensitively', async () => {
      const res = await submit(h(), {
        labId: lab(),
        contentType: 'Application/JSON; charset=UTF-8',
      });
      expectAccepted(res, lab());
    });
  });

  describe('labId', () => {
    it('4.2: a labId that is not a UUID gets 404 lab-not-found, not a validation error', async () => {
      const res = await submit(h(), { labId: 'not-a-uuid' });
      expectProblem(res, 'lab-not-found');
    });
  });

  describe('Idempotency-Key header', () => {
    it('4.2: no Idempotency-Key header gets 400 idempotency-key-missing', async () => {
      const res = await submit(h(), { labId: lab(), key: null });
      expectProblem(res, 'idempotency-key-missing');
    });

    it('4.2: a key of 255 visible ASCII characters is accepted', async () => {
      const res = await submit(h(), { labId: lab(), key: 'k'.repeat(254) + '~' });
      expectAccepted(res, lab());
    });

    it('4.2: a key of 256 characters gets 400 idempotency-key-invalid', async () => {
      const res = await submit(h(), { labId: lab(), key: 'k'.repeat(256) });
      expectProblem(res, 'idempotency-key-invalid');
    });

    it('4.2: a key with a space gets 400 idempotency-key-invalid', async () => {
      const res = await submit(h(), { labId: lab(), key: 'my key' });
      expectProblem(res, 'idempotency-key-invalid');
    });

    it('4.2: a key with a non-ASCII character gets 400 idempotency-key-invalid', async () => {
      const res = await submit(h(), { labId: lab(), key: 'clé-1' });
      expectProblem(res, 'idempotency-key-invalid');
    });

    it('4.2: an empty Idempotency-Key header gets 400 idempotency-key-invalid', async () => {
      const res = await submit(h(), { labId: lab(), key: '' });
      expectProblem(res, 'idempotency-key-invalid');
    });
  });

  describe('body', () => {
    it('4.2: a JSON array body gets 422 validation-failed with pointer ""', async () => {
      const res = await submit(h(), { labId: lab(), body: raw('[]') });
      expectValidationFailed(res, '');
    });

    it('4.2: a JSON null body gets 422 validation-failed with pointer ""', async () => {
      const res = await submit(h(), { labId: lab(), body: raw('null') });
      expectValidationFailed(res, '');
    });

    it('4.2: a JSON string body gets 422 validation-failed with pointer ""', async () => {
      const res = await submit(h(), { labId: lab(), body: raw('"int main() {}"') });
      expectValidationFailed(res, '');
    });

    it('4.2: a body without source gets 422 validation-failed with pointer /source', async () => {
      const res = await submit(h(), { labId: lab(), body: json({}) });
      expectValidationFailed(res, '/source');
    });

    it('4.2: an empty source gets 422 validation-failed with pointer /source', async () => {
      const res = await submit(h(), { labId: lab(), body: json({ source: '' }) });
      expectValidationFailed(res, '/source');
    });

    it('4.2: a source that is not a string gets 422 validation-failed with pointer /source', async () => {
      const res = await submit(h(), { labId: lab(), body: json({ source: 42 }) });
      expectValidationFailed(res, '/source');
    });

    it('4.2: a source containing U+0000 gets 422 validation-failed with pointer /source', async () => {
      const res = await submit(h(), {
        labId: lab(),
        body: json({ source: 'int main() {}\u0000' }),
      });
      expectValidationFailed(res, '/source');
    });

    it('4.2: a source containing an unpaired surrogate gets 422 validation-failed with pointer /source', async () => {
      // Written as the JSON escape \ud800, which is valid JSON but not valid Unicode text.
      const res = await submit(h(), {
        labId: lab(),
        body: raw('{"source":"int main() {} \\ud800"}'),
      });
      expectValidationFailed(res, '/source');
    });

    it('4.2: a source of a single space is accepted (at least 1 character)', async () => {
      const res = await submit(h(), { labId: lab(), body: json({ source: ' ' }) });
      expect(expectAccepted(res, lab()).sizeBytes).toBe(1);
    });

    it('4.2: body fields the server does not know are ignored', async () => {
      const res = await submit(h(), {
        labId: lab(),
        body: json({ source: SOURCE, language: 'c++17', studentName: 'Someone' }),
      });
      expectAccepted(res, lab());
    });
  });

  describe('size limits', () => {
    it('4.2: a source of exactly 65,536 bytes is accepted', async () => {
      const source = 'a'.repeat(MAX_SOURCE_BYTES);
      const res = await submit(h(), { labId: lab(), body: json({ source }) });
      expect(expectAccepted(res, lab()).sizeBytes).toBe(MAX_SOURCE_BYTES);
    });

    it('4.2: a source of 65,537 bytes gets 413 source-too-large', async () => {
      const source = 'a'.repeat(MAX_SOURCE_BYTES + 1);
      const res = await submit(h(), { labId: lab(), body: json({ source }) });
      expectProblem(res, 'source-too-large');
    });

    it('4.2: size is counted in UTF-8 bytes: 32,769 two-byte characters (65,538 bytes) get 413', async () => {
      const source = 'é'.repeat(32_769);
      expect(source.length).toBeLessThan(MAX_SOURCE_BYTES);
      expect(utf8Bytes(source)).toBeGreaterThan(MAX_SOURCE_BYTES);
      const res = await submit(h(), { labId: lab(), body: json({ source }) });
      expectProblem(res, 'source-too-large');
    });

    it('4.2: a whole body over 262,144 bytes gets 413 source-too-large', async () => {
      const body = json({ source: 'a'.repeat(MAX_BODY_BYTES) });
      expect(body.byteLength).toBeGreaterThan(MAX_BODY_BYTES);
      const res = await submit(h(), { labId: lab(), body });
      expectProblem(res, 'source-too-large');
    });

    it('4.2: a source rejected for its size is not a submission', async () => {
      const res = await submit(h(), {
        labId: lab(),
        body: json({ source: 'a'.repeat(MAX_SOURCE_BYTES + 1) }),
      });
      expectProblem(res, 'source-too-large');
      expect(h().queue.calls).toEqual([]);
    });
  });
});
