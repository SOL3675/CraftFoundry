import { createServer } from 'node:net';
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Artifact, LoadedConfig, RuntimeConfig } from '../../core/types.js';
import { resolveTool, sha256File } from '../../core/cache.js';
import { runProcess, type ProcessResult } from '../../platform/process.js';
import { redactText } from '../../reporting/redact.js';
import { collectCrashReports } from '../../reporting/evidence.js';
import { assertContainedPath } from '../../core/paths.js';

export class OwnedServer {
  readonly directory: string;
  readonly owner = randomUUID();
  port = 0;
  private loaded: LoadedConfig;
  private targetId: string;
  private runtime: RuntimeConfig;
  private done?: Promise<ProcessResult>;
  private controller = new AbortController();
  private write?: (input: string) => void;
  private output = '';
  private outputLength = 0;
  private listeners = new Set<() => void>();
  private resolveReady!: () => void;
  private ready = new Promise<void>(resolve => { this.resolveReady = resolve; });
  private reservation?: ReturnType<typeof createServer>;
  private logDir: string;
  private onCancel?: () => void;
  private parentSignal?: AbortSignal;

  constructor(loaded: LoadedConfig, targetId: string, runtime: RuntimeConfig, directory: string, logDir: string) {
    this.loaded = loaded; this.targetId = targetId; this.runtime = runtime; this.directory = directory; this.logDir = logDir;
  }
  async prepare(artifacts: Artifact[], runDirectory: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!this.loaded.local.eulaAccepted) throw new Error('EULA acceptance is required before starting a Minecraft server');
    if (!this.runtime.command || !this.runtime.readyPattern) throw new Error('Server runtime requires an explicit command and readiness pattern');
    await mkdir(path.join(this.directory, 'mods'), { recursive: true });
    const deployed = [];
    for (const artifact of artifacts.filter(item => ['distribution', 'runtime-dependency'].includes(item.kind) && ['both', 'server'].includes(item.side))) {
      const source = path.join(runDirectory, artifact.path);
      if (await sha256File(source) !== artifact.sha256) throw new Error(`Artifact hash changed before deployment: ${artifact.path}`);
      await cp(source, path.join(this.directory, 'mods', path.basename(source)), { errorOnExist: true, force: false });
      deployed.push({ path: `mods/${path.basename(source)}`, sha256: artifact.sha256, kind: artifact.kind, side: artifact.side });
    }
    if (!deployed.some(artifact => artifact.kind === 'distribution')) throw new Error('No server-side distribution artifact was selected');
    this.reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      this.reservation!.once('error', reject); this.reservation!.listen(0, '127.0.0.1', () => { this.port = (this.reservation!.address() as { port: number }).port; resolve(); });
    });
    await writeFile(path.join(this.directory, 'eula.txt'), 'eula=true\n');
    await writeFile(path.join(this.directory, 'server.properties'), `server-ip=127.0.0.1\nserver-port=${this.port}\nonline-mode=false\nlevel-name=world\nlevel-seed=8675309\nlevel-type=minecraft:flat\ngenerate-structures=false\nspawn-protection=0\ndifficulty=peaceful\ngamemode=creative\nview-distance=4\nsimulation-distance=4\nmax-players=4\nenable-rcon=false\nenforce-secure-profile=false\n`);
    await writeFile(path.join(this.directory, 'session.json'), JSON.stringify({ schemaVersion: 1, owner: this.owner, target: this.targetId, port: this.port, bind: '127.0.0.1', seed: 8675309, deployed }, null, 2));
    if (this.runtime.setup) {
      const command = this.runtime.setup;
      const executable = await this.substitute(command.executable, signal);
      const args = await Promise.all(command.args.map(value => this.substitute(value, signal)));
      const result = await runProcess({ executable, args, cwd: this.directory, timeoutMs: this.loaded.local.timeouts?.build ?? 600_000,
        logDir: path.join(this.directory, 'setup-logs'), redact: redactText, signal });
      if (result.status !== 'passed') throw new Error(`Runtime setup ${result.status}: ${result.error ?? result.stderr.slice(-2000)}`);
    }
  }
  private async substitute(value: string, signal?: AbortSignal): Promise<string> {
    if (value === '{java:game}') {
      const role = this.loaded.config.targets[this.targetId]!.java?.game;
      const home = role ? this.loaded.local.java?.[role] : undefined;
      if (!home) throw new Error('Target game Java role must have an explicit home in local config');
      return path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    }
    const tool = /^\{tool:([A-Za-z0-9._-]+)\}$/.exec(value)?.[1];
    if (tool) return resolveTool(this.loaded, tool, signal);
    return value.replaceAll('{sessionRoot}', this.directory).replaceAll('{port}', String(this.port)).replaceAll('{os}', process.platform === 'win32' ? 'win' : 'unix');
  }
  async start(signal?: AbortSignal): Promise<void> {
    try {
      const command = this.runtime.command!;
      const executable = await this.substitute(command.executable, signal);
      const args = await Promise.all(command.args.map(value => this.substitute(value, signal)));
      if (signal?.aborted) throw new Error('Server start cancelled');
      await this.releasePort();
      this.parentSignal = signal; this.onCancel = () => this.controller.abort();
      signal?.addEventListener('abort', this.onCancel, { once: true });
      const readyPattern = new RegExp(this.runtime.readyPattern!);
      this.done = runProcess({ executable, args, cwd: this.directory, logDir: this.logDir, timeoutMs: this.loaded.local.timeouts?.test ?? 300_000,
        stopTimeoutMs: this.loaded.local.timeouts?.stop ?? 10_000, signal: this.controller.signal, gracefulInput: 'stop\n', redact: redactText,
        onStart: control => { this.write = control.write; },
        onOutput: (_stream, text) => {
          this.outputLength += text.length; this.output = (this.output + text).slice(-1024 * 1024);
          if (readyPattern.test(this.output)) this.resolveReady();
          for (const listener of this.listeners) listener();
        } });
    } catch (error) { await this.releasePort(); throw error; }
  }
  async waitReady(): Promise<void> {
    if (!this.done) throw new Error('Server has not started');
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.ready,
        this.done.then(result => { throw new Error(`Server exited before readiness (exit ${result.exitCode}): ${result.error ?? `${result.stdout.slice(-3000)}\n${result.stderr.slice(-1000)}`}`); }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Server readiness timeout')), this.loaded.local.timeouts?.start ?? 120_000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  command(command: string): void {
    if (!this.write || /[\r\n\0]/.test(command)) throw new Error('Server command needs a running owned session and one line');
    this.write(`${command}\n`);
  }
  mark(): number { return this.outputLength; }
  async waitForOutput(pattern: RegExp, timeoutMs: number, after = 0): Promise<string> {
    if (!this.done) throw new Error('Server has not started');
    let listener: (() => void) | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        listener = () => {
          const start = Math.max(0, after - (this.outputLength - this.output.length));
          pattern.lastIndex = 0; const match = pattern.exec(this.output.slice(start));
          if (match) resolve(match[0]);
        };
        this.listeners.add(listener); listener();
        timer = setTimeout(() => reject(new Error(`Server output condition timed out: ${pattern.source}`)), timeoutMs);
        this.done!.then(result => reject(new Error(`Server exited while waiting for output: ${result.status}`)), reject);
      });
    } finally { if (listener) this.listeners.delete(listener); clearTimeout(timer); }
  }
  async stop(): Promise<ProcessResult | undefined> {
    await this.releasePort();
    if (!this.done) return undefined;
    this.controller.abort();
    const result = await this.done;
    if (this.onCancel) this.parentSignal?.removeEventListener('abort', this.onCancel);
    return result;
  }
  private async releasePort(): Promise<void> {
    if (this.reservation?.listening) await new Promise<void>(resolve => this.reservation!.close(() => resolve()));
  }
  async collectEvidence(): Promise<string[]> {
    const files = ['session.json', 'server.properties', 'logs/latest.log', 'setup-logs/stdout.log', 'setup-logs/stderr.log'];
    const present: string[] = [];
    for (const file of files) {
      try {
        const target = path.join(this.directory, file);
        await assertContainedPath(this.directory, target);
        if (!(await lstat(target)).isFile()) throw new Error(`Server evidence is not a regular owned file: ${file}`);
        const content = await readFile(target, 'utf8');
        await assertContainedPath(this.directory, target);
        if (!(await lstat(target)).isFile()) throw new Error(`Server evidence changed before redaction: ${file}`);
        await writeFile(target, redactText(content)); present.push(file);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return [...present, ...await collectCrashReports(this.directory)];
  }
}
