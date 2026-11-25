import { runContainer } from './docker.js';
import { archive } from './tar.js';

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
  onContainer?: (id: string, phase: 'compile' | 'test') => Promise<void> | void;
}
export type JudgeStatus = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE';
export interface JudgeResult {
  status: JudgeStatus;
  tests: { status: JudgeStatus; wallTimedOut: boolean; outputExceeded: boolean }[];
  compilerMessage?: string;
}

/** Compiles once, then runs each test in its own isolated container. */
export async function judge(request: JudgeRequest): Promise<JudgeResult> {
  if (!/^(?:[A-Za-z0-9._/:-]+@)?sha256:[0-9a-f]{64}$/.test(request.image))
    throw new Error('A digest-pinned sandbox image is required.');
  if (
    !Number.isInteger(request.cpuSeconds) ||
    request.cpuSeconds < 1 ||
    request.cpuSeconds > 5 ||
    !Number.isInteger(request.memoryMb) ||
    request.memoryMb < 64 ||
    request.memoryMb > 512
  )
    throw new Error('Invalid sandbox limits.');
  if (
    !request.source ||
    request.source.includes('\0') ||
    Buffer.byteLength(request.source, 'utf8') > 65536 ||
    !Array.isArray(request.cases) ||
    request.cases.length < 1 ||
    request.cases.length > 50 ||
    request.cases.some(
      (item) =>
        typeof item.input !== 'string' ||
        typeof item.expectedOutput !== 'string' ||
        Buffer.byteLength(item.input, 'utf8') > 65536 ||
        Buffer.byteLength(item.expectedOutput, 'utf8') > 1048576,
    )
  )
    throw new Error('Invalid submission or test cases.');

  const compiled = await runContainer({
    image: request.image,
    phase: 'compile',
    input: Buffer.from(request.source, 'utf8'),
    script:
      'cat > /tmp/main.cpp && g++ -std=c++17 -O2 /tmp/main.cpp -o /tmp/program >&2 && base64 -w 0 /tmp/program',
    memoryMb: 512,
    cpuSeconds: 10,
    wallMs: 10000,
    outputLimit: 16 * 1024 * 1024,
    onContainer: request.onContainer,
  });
  if (
    compiled.exitCode !== 0 ||
    compiled.wallTimedOut ||
    compiled.outputExceeded ||
    compiled.oomKilled
  ) {
    return {
      status: 'CE',
      tests: [],
      compilerMessage: compiled.stderr.toString('utf8').slice(0, 65536),
    };
  }
  const encoded = compiled.stdout.toString('ascii').trim();
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error('Sandbox compiler returned an invalid executable.');
  const executable = Buffer.from(encoded, 'base64');
  if (
    executable.length < 4 ||
    !executable.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  )
    throw new Error('Sandbox compiler did not return an ELF executable.');

  const tests: JudgeResult['tests'] = [];
  for (const test of request.cases) {
    const execution = await runContainer({
      image: request.image,
      phase: 'test',
      input: archive(executable, Buffer.from(test.input, 'utf8')),
      // Keep a shell as PID 1: Linux can ignore default signals for PID 1, including SIGXCPU.
      script:
        'tar -xf - -C /tmp || exit 1; /usr/bin/env -i /tmp/program < /tmp/input & child=$!; wait "$child"',
      memoryMb: request.memoryMb,
      cpuSeconds: request.cpuSeconds,
      wallMs: request.cpuSeconds * 3000,
      outputLimit: 1024 * 1024,
      onContainer: request.onContainer,
    });
    const tokens = (value: string) => (value.trim() ? value.trim().split(/\s+/) : []);
    const actual = tokens(execution.stdout.toString('utf8'));
    const expected = tokens(test.expectedOutput);
    let status: JudgeStatus = 'AC';
    if (execution.wallTimedOut || execution.exitCode === 152) status = 'TLE';
    else if (execution.outputExceeded) status = 'RE';
    else if (execution.oomKilled) status = 'MLE';
    else if (execution.exitCode !== 0) status = 'RE';
    else if (
      actual.length !== expected.length ||
      actual.some((token, index) => token !== expected[index])
    )
      status = 'WA';
    tests.push({
      status,
      wallTimedOut: execution.wallTimedOut,
      outputExceeded: execution.outputExceeded,
    });
  }
  return { status: tests.find((test) => test.status !== 'AC')?.status ?? 'AC', tests };
}
