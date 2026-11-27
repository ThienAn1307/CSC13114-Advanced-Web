export interface StudentSubmissionStatus {
  id: string;
  labId: string;
  status: string;
  receivedAt: Date;
  sizeBytes: number;
}

export interface StudentSubmissions {
  list(studentId: string): Promise<StudentSubmissionStatus[]>;
}

export const STUDENT_SUBMISSIONS = Symbol('STUDENT_SUBMISSIONS');
