import type { Principal } from '../common/request.js';

export interface Classroom {
  id: string;
  code: string;
  name: string;
}
export interface Classrooms {
  createClass(code: string, name: string): Promise<Classroom>;
  listClasses(principal: Principal): Promise<Classroom[]>;
}
export const CLASSROOMS = Symbol('CLASSROOMS');
