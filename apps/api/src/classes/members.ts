import type { Principal } from '../common/request.js';

export interface NewMember {
  email: string;
  displayName: string;
  passwordHash?: string;
  role: 'ta' | 'student';
}

export type AddMemberResult = 'added' | 'unavailable' | 'invalid-account';
export interface Members {
  add(principal: Principal, classId: string, member: NewMember): Promise<AddMemberResult>;
}
export const MEMBERS = Symbol('MEMBERS');
