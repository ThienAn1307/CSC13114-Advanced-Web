import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_BYTES = 64;

/** Store the algorithm and salt alongside the derived key, never the password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, KEY_BYTES)) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (
    parts.length !== 3 ||
    parts[0] !== 'scrypt' ||
    !/^[0-9a-f]{32}$/.test(parts[1] ?? '') ||
    !/^[0-9a-f]{128}$/.test(parts[2] ?? '')
  )
    return false;
  const expected = Buffer.from(parts[2]!, 'hex');
  const actual = (await scrypt(password, parts[1]!, KEY_BYTES)) as Buffer;
  return timingSafeEqual(actual, expected);
}
