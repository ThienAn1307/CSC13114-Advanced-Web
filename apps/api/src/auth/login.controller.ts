import { createHmac, randomBytes } from 'node:crypto';
import { Body, Controller, Header, HttpCode, Inject, Post } from '@nestjs/common';
import { API_CONFIG } from '../config.js';
import type { ApiConfig } from '../config.js';
import { Problem } from '../common/problem.js';
import { ACCOUNTS } from './accounts.js';
import type { Accounts } from './accounts.js';
import { hashPassword, verifyPassword } from './password.js';

// A missing user still runs scrypt, avoiding an inexpensive account-existence oracle.
const dummyHash = hashPassword(randomBytes(32).toString('hex'));

@Controller('v1/auth')
export class LoginController {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(@Body() body: unknown): Promise<{ accessToken: string }> {
    const value =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
    const password =
      typeof value.password === 'string' && value.password.length <= 1024 ? value.password : '';
    const account = await this.accounts.findByEmail(email);
    const valid = await verifyPassword(password, account?.passwordHash ?? (await dummyHash));
    if (!account?.passwordHash || !valid || !email || !password) {
      throw new Problem('unauthenticated', 'Invalid email or password.');
    }
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: account.id,
        role: account.role,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const message = `${header}.${payload}`;
    const signature = createHmac('sha256', this.config.jwtSecret)
      .update(message)
      .digest('base64url');
    return { accessToken: `${message}.${signature}` };
  }
}
