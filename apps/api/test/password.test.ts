import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('password hashing', () => {
  it('uses a fresh salt and verifies only the original password', async () => {
    const first = await hashPassword('test password');
    const second = await hashPassword('test password');
    expect(first).not.toBe(second);
    await expect(verifyPassword('test password', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', first)).resolves.toBe(false);
  });

  it('rejects malformed or unsupported stored hashes', async () => {
    for (const hash of ['', 'scrypt$not-hex$abc', 'other$0011$abcd']) {
      await expect(verifyPassword('test password', hash)).resolves.toBe(false);
    }
  });
});
