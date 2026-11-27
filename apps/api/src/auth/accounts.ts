import type { Principal } from '../common/request.js';

export interface LoginAccount extends Principal {
  passwordHash: string | null;
}

export interface Accounts {
  findByEmail(email: string): Promise<LoginAccount | null>;
}

export const ACCOUNTS = Symbol('ACCOUNTS');
