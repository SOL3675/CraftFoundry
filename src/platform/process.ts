import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { windowsOwnedCommand } from './windows.js';

export type ProcessStatus = 'passed' | 'failed' | 'timed-out' | 'cancelled' | 'infrastructure-error';
export interface ProcessOptions {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  logDir: string;
  signal?: AbortSignal;
  gracefulInput?: string;
  stopTimeoutMs?: number;
  /** Stop noisy processes rather than allowing unbounded retained output. */
  maxOutputBytes?: number;
  /** Called before output is returned or saved to disk. */
  redact?: (text: string) => string;
  /** Live output for readiness checks; saved and returned output is redacted. */
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
  /** Control belongs to the live invocation, never a persisted PID. */
  onStart?: (control: { write(input: string): void }) => void;
}
export interface ProcessResult {
  status: ProcessStatus;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  logs: { stdout: string; stderr: string };
  error?: string;
}

/** Own one process tree for this invocation; never recover ownership from a PID file. */
export async function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const start = performance.now();
  const logs = { stdout: resolve(options.logDir, 'stdout.log'), stderr: resolve(options.logDir, 'stderr.log') };
  let stdout = '';
  let stderr = '';
  let result: ProcessResult;
  try {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647) throw new Error('timeoutMs must be a positive bounded number');
    const stopTimeoutMs = options.stopTimeoutMs ?? 2_000;
    const maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error('maxOutputBytes must be a positive integer');
    if (!Number.isFinite(stopTimeoutMs) || stopTimeoutMs < 0 || stopTimeoutMs > 2_147_483_647) throw new Error('stopTimeoutMs must be a non-negative bounded number');
    if (!options.executable || /[\0\r\n]/u.test(options.executable) || options.args.some(arg => arg.includes('\0'))) throw new Error('Invalid executable or process argument');
    await mkdir(options.logDir, { recursive: true });
    if (options.signal?.aborted) {
      result = { status: 'cancelled', exitCode: null, signal: null, durationMs: 0, stdout, stderr, logs };
    } else {
      const launch = process.platform === 'win32' ? windowsOwnedCommand(options.executable, options.args, resolve(options.cwd)) : options;
      result = await new Promise<ProcessResult>((complete) => {
        const child = spawn(launch.executable, launch.args, { cwd: options.cwd, env: { ...process.env, ...options.env }, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
        const stdoutDecoder = new StringDecoder('utf8');
        const stderrDecoder = new StringDecoder('utf8');
        let status: ProcessStatus | undefined;
        let error: string | undefined;
        let finished = false;
        let exitCode: number | null = null;
        let exitSignal: string | null = null;
        let shutdown: NodeJS.Timeout | undefined;
        let watchdog: NodeJS.Timeout | undefined;
        let outputBytes = 0;
        let outputLimited = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          clearTimeout(shutdown);
          clearTimeout(watchdog);
          options.signal?.removeEventListener('abort', cancel);
          stdout += stdoutDecoder.end(); stderr += stderrDecoder.end();
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
          complete({ status: status ?? (exitCode === 0 ? 'passed' : 'failed'), exitCode, signal: exitSignal, durationMs: performance.now() - start, stdout, stderr, logs, ...(error ? { error } : {}) });
        };
        const killTree = (force: boolean) => {
          const pid = child.pid;
          if (!pid) return;
          if (process.platform === 'win32') {
            // pid is from this live spawn, never supplied externally. Closing the
            // guardian's job handle kills descendants even if their parent exited.
            const killer = spawn(resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', ...(force ? ['/f'] : [])], { windowsHide: true, shell: false, stdio: 'ignore' });
            killer.on('error', e => { error = `Unable to stop owned process tree: ${e.message}`; });
            const killerTimeout = setTimeout(() => { killer.kill(); }, 1_000);
            killer.once('close', () => clearTimeout(killerTimeout));
            // Restricted Windows tokens can prevent taskkill's tree enumeration.
            // Terminating our own guardian also closes its job and is sufficient
            // to terminate the exact owned tree without enumerating other PIDs.
            if (force) child.kill('SIGKILL');
          } else {
            try { process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM'); }
            catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') error = `Unable to stop owned process group: ${(e as Error).message}`; }
          }
        };
        const stop = (reason: ProcessStatus) => {
          if (finished || status) return;
          status = reason;
          if (options.gracefulInput !== undefined) child.stdin.write(options.gracefulInput, () => {});
          else if (process.platform !== 'win32') killTree(false);
          shutdown = setTimeout(() => {
            killTree(true);
            watchdog = setTimeout(() => { error ??= 'Owned process did not close after forced shutdown'; finish(); }, 5_000);
          }, stopTimeoutMs);
        };
        const cancel = () => stop('cancelled');
        const timeout = setTimeout(() => stop('timed-out'), options.timeoutMs);
        options.signal?.addEventListener('abort', cancel, { once: true });
        const output = (stream: 'stdout' | 'stderr', text: string) => {
          if (outputLimited) return;
          outputBytes += Buffer.byteLength(text);
          if (outputBytes > maxOutputBytes) {
            outputLimited = true; error = `Process output exceeds ${maxOutputBytes} byte limit; retained logs were truncated`;
            stop('infrastructure-error'); return;
          }
          if (stream === 'stdout') stdout += text; else stderr += text;
          try { options.onOutput?.(stream, text); }
          catch (e) { error = `Process output callback failed: ${(e as Error).message}`; stop('infrastructure-error'); }
        };
        child.stdout.on('data', (chunk: Buffer) => output('stdout', stdoutDecoder.write(chunk)));
        child.stderr.on('data', (chunk: Buffer) => output('stderr', stderrDecoder.write(chunk)));
        child.once('spawn', () => {
          try { options.onStart?.({ write: (input: string) => { if (finished || child.stdin.destroyed) throw new Error('Process stdin is closed'); child.stdin.write(input); } }); }
          catch (e) { error = `Process start callback failed: ${(e as Error).message}`; stop('infrastructure-error'); }
        });
        child.stdin.on('error', () => {});
        child.on('error', e => { status = 'infrastructure-error'; error = e.message; finish(); });
        child.on('exit', (code, signal) => {
          exitCode = code; exitSignal = signal;
          if (process.platform !== 'win32') killTree(true);
        });
        child.on('close', (code, signal) => {
          exitCode = code; exitSignal = signal;
          if (process.platform === 'win32' && code === 125 && stderr.includes('Harness process infrastructure error:')) status = 'infrastructure-error';
          finish();
        });
        if (options.signal?.aborted) cancel();
      });
    }
  } catch (e) {
    result = { status: 'infrastructure-error', exitCode: null, signal: null, durationMs: performance.now() - start, stdout, stderr, logs, error: (e as Error).message };
  }
  const redact = options.redact ?? ((text: string) => text);
  result.stdout = redact(result.stdout); result.stderr = redact(result.stderr);
  if (result.error) result.error = redact(result.error);
  result.durationMs = performance.now() - start;
  try {
    await mkdir(options.logDir, { recursive: true });
    await Promise.all([writeFile(logs.stdout, result.stdout, 'utf8'), writeFile(logs.stderr, result.stderr, 'utf8')]);
  } catch (e) {
    result.status = 'infrastructure-error'; result.error = `Unable to save process logs: ${redact((e as Error).message)}`;
  }
  return result;
}
