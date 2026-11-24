import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// The Docker client receives only connection and operating-system settings, never model keys.
function dockerEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'USERPROFILE',
    'HOME',
    'TEMP',
    'TMP',
    'DOCKER_HOST',
    'XDG_RUNTIME_DIR',
  ]) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  return result;
}

async function docker(args: string[]): Promise<string> {
  const result = await exec('docker', args, {
    env: dockerEnvironment(),
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

async function removeOwnedContainer(
  target: string,
  owner: string,
  required: boolean,
): Promise<void> {
  let label: string;
  try {
    label = await docker([
      'inspect',
      '--format',
      '{{index .Config.Labels "leetkob.owner"}}',
      target,
    ]);
  } catch {
    if (required) throw new Error('Sandbox cleanup failed; inspect the Docker host.');
    return;
  }
  if (label !== owner) {
    if (required) throw new Error('Sandbox ownership could not be verified.');
    return;
  }
  try {
    await docker(['rm', '-f', target]);
  } catch {
    throw new Error('Sandbox cleanup failed; inspect the Docker host.');
  }
}

interface ContainerRequest {
  image: string;
  phase: 'compile' | 'test';
  script: string;
  input: Buffer;
  memoryMb: number;
  cpuSeconds: number;
  wallMs: number;
  outputLimit: number;
  onContainer?: (id: string, phase: 'compile' | 'test') => Promise<void> | void;
}

export interface ContainerResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
  oomKilled: boolean;
  wallTimedOut: boolean;
  outputExceeded: boolean;
}

/** Create with fixed isolation settings, attach input, then remove only this container. */
export async function runContainer(request: ContainerRequest): Promise<ContainerResult> {
  const owner = randomUUID();
  const name = `leetkob-judge-${owner}`;
  let id = name;
  let created = false;
  try {
    const containerId = await docker([
      'create',
      '--interactive',
      '--name',
      name,
      '--label',
      'leetkob.sandbox=true',
      '--label',
      `leetkob.owner=${owner}`,
      '--network',
      'none',
      '--user',
      '65534:65534',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,exec,nosuid,size=16m,uid=65534,gid=65534,mode=0700',
      '--memory',
      `${request.memoryMb}m`,
      '--memory-swap',
      `${request.memoryMb}m`,
      '--pids-limit',
      '16',
      '--cpus',
      '1',
      '--ulimit',
      `cpu=${request.cpuSeconds}:${request.cpuSeconds + 1}`,
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--entrypoint',
      '/usr/bin/env',
      request.image,
      '-i',
      'PATH=/usr/bin:/bin',
      '/bin/sh',
      '-c',
      request.script,
    ]);
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error('Invalid container identifier.');
    id = containerId;
    created = true;
    await request.onContainer?.(id, request.phase);

    let outputBytes = 0;
    let outputExceeded = false;
    let wallTimedOut = false;
    let stopping: Promise<void> | undefined;
    let stopFailed = false;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const stop = () => {
      stopping ??= docker(['kill', id])
        .then(() => undefined)
        .catch(async () => {
          // The container may still be starting. Removing this known ID prevents it starting later.
          await docker(['rm', '-f', id]);
          created = false;
        })
        .catch(() => {
          stopFailed = true;
        });
    };
    const child = spawn('docker', ['start', '--attach', '--interactive', id], {
      env: dockerEnvironment(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      const available = Math.max(0, request.outputLimit - outputBytes);
      if (available) target.push(chunk.subarray(0, available));
      outputBytes += chunk.length;
      if (outputBytes > request.outputLimit && !outputExceeded && !wallTimedOut) {
        outputExceeded = true;
        stop();
      }
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.stdin.on('error', () => {
      /* A failed compilation or stopped container can close stdin early. */
    });
    child.stdin.end(request.input);
    const timer = setTimeout(() => {
      if (!outputExceeded) {
        wallTimedOut = true;
        stop();
      }
    }, request.wallMs);
    const watchdog = setTimeout(() => child.kill(), request.wallMs + 20000);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', () => resolve());
      });
      if (stopping) await stopping;
      if (stopFailed) throw new Error('Sandbox could not be stopped.');
    } finally {
      clearTimeout(timer);
      clearTimeout(watchdog);
    }
    if (!created)
      return {
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err),
        exitCode: -1,
        oomKilled: false,
        wallTimedOut,
        outputExceeded,
      };
    const state = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', id])) as {
      Running: boolean;
      Status: string;
      ExitCode: number;
      OOMKilled: boolean;
    };
    if (state.Running || state.Status !== 'exited')
      throw new Error('Sandbox container did not finish normally.');
    return {
      stdout: Buffer.concat(out),
      stderr: Buffer.concat(err),
      exitCode: state.ExitCode,
      oomKilled: state.OOMKilled,
      wallTimedOut,
      outputExceeded,
    };
  } finally {
    await removeOwnedContainer(id, owner, created);
  }
}
