export interface JudgeCase {
  input: string;
  expectedOutput: string;
}
export interface JudgeRequest {
  image: string;
  source: string;
  cases: JudgeCase[];
  cpuSeconds: number;
  memoryMb: number;
}
export type JudgeStatus = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE';
export interface JudgeResult {
  status: JudgeStatus;
  tests: { status: JudgeStatus }[];
}

export function judge(_request: JudgeRequest): Promise<JudgeResult> {
  void _request;
  return Promise.reject(new Error('Sandbox is not implemented yet.'));
}
