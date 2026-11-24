export interface StudentSubmissionStatus {
  id: string;
  labId: string;
  status: string;
  receivedAt: Date;
  sizeBytes: number;
}

export interface StudentSubmissions {
  list(studentId: string): Promise<StudentSubmissionStatus[]>;
  listTests(
    studentId: string,
    submissionId: string,
  ): Promise<{ position: number; status: string }[] | null>;
}

export const STUDENT_SUBMISSIONS = Symbol('STUDENT_SUBMISSIONS');
