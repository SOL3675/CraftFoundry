import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../platform/process.js';
import type { ProcessResult } from '../../platform/process.js';
import { cleanupNativeAliases } from './native-paths.js';

export const MC_PILOT_VERSION = '0.15.0';
export interface McPilotOptions {
  backendRoot: string;
  runDir: string;
  clientName: string;
  minecraft: string;
  loader: 'fabric' | 'forge' | 'neoforge';
  /** Exact loader pin; overrides the published catalog through its installer dependency. */
  loaderVersion?: string;
  /** Maximum installer download concurrency in this session's explicit overlay. */
  downloadConcurrency?: number;
  /** Read-only content-addressed asset objects, never platform libraries or ready markers. */
  assetCache?: string;
  java: string;
  wsPort: number;
  account?: string;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  sessionTimeoutMs?: number;
  stopTimeoutMs?: number;
  redact?: (text: string) => string;
  expectedHelperSha256?: string;
  /** Explicit fixed helper artifact avoids the npm package's stale release URL. */
  helperArtifact?: { path: string; sha256: string };
}
export interface McPilotClient {
  name: string;
  minecraftDir: string;
  modsDir: string;
  helperJar: string;
  helperSha256: string;
  wsPort: number;
  [key: string]: unknown;
}
interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }

/** One fresh client session. The broker delegates normal lifecycle to mc-pilot. */
export class McPilotRuntimeAdapter {
  readonly home: string;
  readonly cache: string;
  private options: McPilotOptions;
  private controller = new AbortController();
  private processControl?: { write(input: string): void };
  private process?: Promise<ProcessResult>;
  private pending = new Map<string, Pending>();
  private ready?: Promise<void>;
  private client?: McPilotClient;
  private stopped = false;
  private lines = '';
  private assetSeed?: { objects: number; bytes: number; indexes?: number };
  private nativeOwner = randomUUID();

  constructor(options: McPilotOptions) {
    if (!/^[a-zA-Z0-9_-]+$/u.test(options.clientName)) throw new Error('mc-pilot client name must contain only letters, digits, hyphens and underscores');
    if (!Number.isInteger(options.wsPort) || options.wsPort < 1024 || options.wsPort > 65535) throw new Error('mc-pilot WebSocket port must be from 1024 to 65535');
    if (!isAbsolute(options.java)) throw new Error('mc-pilot game Java must be an explicit absolute executable path');
    if (!/^\d+\.\d+(?:\.\d+)?$/u.test(options.minecraft) || !['fabric', 'forge', 'neoforge'].includes(options.loader)) throw new Error('Invalid mc-pilot Minecraft version or loader');
    if (options.loaderVersion && !/^\d+(?:\.\d+){1,3}(?:-[a-zA-Z0-9.]+)?$/u.test(options.loaderVersion)) throw new Error('Invalid explicit mc-pilot loader version');
    if (options.downloadConcurrency !== undefined && (!Number.isInteger(options.downloadConcurrency) || options.downloadConcurrency < 1 || options.downloadConcurrency > 16)) throw new Error('Download concurrency must be an integer from 1 to 16');
    if (options.assetCache !== undefined && !isAbsolute(options.assetCache)) throw new Error('Asset cache must be an explicit absolute directory');
    this.options = options;
    this.home = resolve(options.runDir, 'mct-home'); this.cache = resolve(options.runDir, 'mct-cache');
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }

  private async startBroker(): Promise<void> {
    if (this.stopped) throw new Error('mc-pilot session is stopped');
    if (this.ready) return this.ready;
    await mkdir(this.options.runDir, { recursive: true });
    // Refuse existing state: this adapter never recovers ownership from a PID.
    await mkdir(this.home);
    await mkdir(this.cache);
    if (this.options.assetCache) {
      const source = await realpath(this.options.assetCache);
      const destination = join(this.cache, 'client', 'runtime', this.options.minecraft, 'assets', 'objects');
      const seeded: { objects: number; bytes: number; indexes?: number } = { objects: 0, bytes: 0 };
      for (const prefix of await readdir(source, { withFileTypes: true })) {
        if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/u.test(prefix.name)) continue;
        for (const entry of await readdir(join(source, prefix.name), { withFileTypes: true })) {
          if (this.options.signal?.aborted) throw new Error('Asset cache preparation cancelled');
          if (!entry.isFile() || !/^[a-f0-9]{40}$/u.test(entry.name) || !entry.name.startsWith(prefix.name)) continue;
          if (++seeded.objects > 100_000) throw new Error('Asset seed exceeds the bounded object limit');
          const file = join(source, prefix.name, entry.name);
          if ((await stat(file)).size > 128 * 1024 * 1024) throw new Error('Asset seed object exceeds the bounded size limit');
          const content = await readFile(file);
          if (createHash('sha1').update(content).digest('hex') !== entry.name) throw new Error(`Asset seed SHA-1 mismatch: ${entry.name}`);
          await mkdir(join(destination, prefix.name), { recursive: true });
          await writeFile(join(destination, prefix.name, entry.name), content, { flag: 'wx' }); seeded.bytes += content.length;
        }
      }
      const indexes = join(dirname(source), 'indexes');
      for (const entry of await readdir(indexes, { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; })) {
        if (!entry.isFile() || !/^[a-f0-9]{40}\.json$/u.test(entry.name)) continue;
        if (this.options.signal?.aborted) throw new Error('Asset index preparation cancelled');
        if ((await stat(join(indexes, entry.name))).size > 16 * 1024 * 1024) throw new Error('Asset index seed exceeds the bounded size limit');
        const content = await readFile(join(indexes, entry.name));
        if (content.length > 16 * 1024 * 1024 || createHash('sha1').update(content).digest('hex') !== entry.name.slice(0, 40)) throw new Error(`Asset index seed SHA-1 mismatch: ${entry.name}`);
        const index = JSON.parse(content.toString('utf8')) as { objects?: Record<string, { hash?: string; size?: number }> };
        if (!index.objects || typeof index.objects !== 'object' || Array.isArray(index.objects) || Object.keys(index.objects).length > 100_000 || Object.values(index.objects).some(item => !item || typeof item.hash !== 'string' || !/^[a-f0-9]{40}$/u.test(item.hash) || !Number.isInteger(item.size) || item.size! < 0)) throw new Error('Invalid content-addressed asset index seed');
        const targetIndexes = join(this.cache, 'client', 'runtime', this.options.minecraft, 'assets', 'indexes');
        await mkdir(targetIndexes, { recursive: true }); await writeFile(join(targetIndexes, entry.name), content, { flag: 'wx' });
        seeded.indexes = (seeded.indexes ?? 0) + 1; seeded.bytes += content.length;
      }
      this.assetSeed = seeded;
    }
    if (this.options.helperArtifact) {
      const artifact = this.options.helperArtifact;
      const content = await readFile(artifact.path);
      if (!/^[a-f0-9]{64}$/iu.test(artifact.sha256) || createHash('sha256').update(content).digest('hex') !== artifact.sha256.toLowerCase()) throw new Error('Pinned mc-pilot helper artifact SHA-256 mismatch');
      const helperCache = join(this.cache, 'mod'); await mkdir(helperCache);
      await copyFile(artifact.path, join(helperCache, `mct-client-mod-${this.options.loader}-${this.options.minecraft}.jar`), 1);
    }
    this.ready = new Promise<void>((accept, reject) => {
      const readyTimeout = setTimeout(() => { reject(new Error('mc-pilot broker startup timed out')); this.controller.abort(); }, this.options.requestTimeoutMs ?? 30_000);
      const fail = (error: Error) => { clearTimeout(readyTimeout); reject(error); this.rejectPending(error); };
      this.process = runProcess({ executable: process.execPath, args: [join(dirname(fileURLToPath(import.meta.url)), 'mc-pilot-broker.js'), JSON.stringify({ backendRoot: resolve(this.options.backendRoot), home: this.home, cache: this.cache, clientName: this.options.clientName, nativeOwner: this.nativeOwner, downloadConcurrency: this.options.downloadConcurrency })], cwd: resolve(this.options.runDir), env: { MCT_HOME: this.home, MCT_CACHE_DIR: this.cache, MCT_CLIENT_LANGUAGE: 'en_us' }, timeoutMs: this.options.sessionTimeoutMs ?? 1_800_000, stopTimeoutMs: 100, logDir: join(this.options.runDir, 'broker-logs'), signal: this.options.signal ? AbortSignal.any([this.controller.signal, this.options.signal]) : this.controller.signal, redact: this.options.redact, onStart: control => { this.processControl = control; }, onOutput: (stream, text) => {
        if (stream !== 'stdout') return;
        this.lines += text;
        if (this.lines.length > 16 * 1024 * 1024) throw new Error('mc-pilot broker response exceeds output limit');
        let newline: number;
        while ((newline = this.lines.indexOf('\n')) >= 0) {
          const line = this.lines.slice(0, newline); this.lines = this.lines.slice(newline + 1);
          const response = JSON.parse(line) as { event?: string; version?: string; id?: string; success?: boolean; data?: unknown; error?: string };
          if (response.event === 'ready') { if (response.version !== MC_PILOT_VERSION) throw new Error('Unexpected mc-pilot broker version'); clearTimeout(readyTimeout); accept(); }
          else if (response.event === 'error') fail(new Error(response.error ?? 'mc-pilot broker failed'));
          else if (response.id) { const request = this.pending.get(response.id); if (!request) continue; clearTimeout(request.timer); this.pending.delete(response.id); if (response.success) request.resolve(response.data); else request.reject(new Error(response.error ?? 'mc-pilot request failed')); }
        }
      } }).then(result => { fail(new Error(`mc-pilot broker ended (${result.status}): ${result.error ?? result.stderr}`)); return result; }).finally(() => cleanupNativeAliases(this.cache, this.nativeOwner));
    });
    return this.ready;
  }

  private async request<T>(operation: string, params: Record<string, unknown>, timeoutMs = this.options.requestTimeoutMs ?? 30_000): Promise<T> {
    await this.startBroker();
    if (!this.processControl || this.stopped || this.controller.signal.aborted) throw new Error('mc-pilot broker is unavailable');
    const id = randomUUID();
    return new Promise<T>((accept, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.controller.abort(); reject(new Error(`mc-pilot ${operation} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: value => accept(value as T), reject, timer });
      try { this.processControl!.write(`${JSON.stringify({ id, operation, params })}\n`); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  private async ownedPath(path: string): Promise<string> {
    const canonical = await realpath(path);
    const rel = relative(await realpath(this.home), canonical);
    if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('mc-pilot returned a path outside its isolated home');
    return canonical;
  }

  async create(): Promise<McPilotClient> {
    const downloaded = await this.request<Omit<McPilotClient, 'helperSha256'>>('create', { minecraft: this.options.minecraft, loader: this.options.loader, loaderVersion: this.options.loaderVersion, java: this.options.java, wsPort: this.options.wsPort, account: this.options.account });
    const helperJar = await this.ownedPath(String(downloaded.helperJar));
    const helperSha256 = createHash('sha256').update(await readFile(helperJar)).digest('hex');
    const expectedHelperSha256 = this.options.expectedHelperSha256 ?? this.options.helperArtifact?.sha256;
    if (expectedHelperSha256 && helperSha256 !== expectedHelperSha256.toLowerCase()) throw new Error('mc-pilot helper JAR hash does not match the pinned helper');
    this.client = { ...downloaded, name: this.options.clientName, wsPort: this.options.wsPort, helperJar, helperSha256, minecraftDir: await this.ownedPath(String(downloaded.minecraftDir)), modsDir: await this.ownedPath(String(downloaded.modsDir)), ...(this.assetSeed ? { assetSeed: this.assetSeed } : {}) };
    return this.client;
  }

  async deployMod(path: string, expectedSha256: string): Promise<{ path: string; sha256: string }> {
    if (!this.client) throw new Error('Create the mc-pilot client before deploying a Mod');
    if (!/^[a-f0-9]{64}$/iu.test(expectedSha256)) throw new Error('A SHA-256 hash is required when deploying a Mod');
    const source = await realpath(path);
    if (!(await stat(source)).isFile() || !source.endsWith('.jar')) throw new Error('A Mod artifact must be an explicit JAR file');
    const sha256 = createHash('sha256').update(await readFile(source)).digest('hex');
    if (sha256 !== expectedSha256.toLowerCase()) throw new Error('Mod artifact SHA-256 mismatch');
    const destination = join(await this.ownedPath(this.client.modsDir), basename(source));
    await copyFile(source, destination, 1); // COPYFILE_EXCL: never replace a helper.
    return { path: destination, sha256 };
  }

  async launch(server?: string): Promise<Record<string, unknown>> {
    if (server && !/^(?:127\.0\.0\.1|localhost):\d{1,5}$/u.test(server)) throw new Error('mc-pilot test server must use loopback with an explicit port');
    return this.request('launch', { server, account: this.options.account });
  }

  /** Distribution smoke: the real game launches without the automation Mod. */
  async launchWithoutHelper(server: string): Promise<Record<string, unknown>> {
    if (!this.client) throw new Error('Create the isolated client before removing its automation helper');
    const helper = await this.ownedPath(this.client.helperJar);
    if (createHash('sha256').update(await readFile(helper)).digest('hex') !== this.client.helperSha256) throw new Error('Automation helper changed before helper-free smoke');
    await unlink(helper);
    return { ...await this.launch(server), helperEnabled: false };
  }

  async waitReady(timeoutMs: number, requireWorld = true): Promise<Record<string, unknown>> {
    const result = await this.request<Record<string, unknown>>('waitReady', { timeoutSeconds: Math.ceil(timeoutMs / 1000), requireWorld }, timeoutMs + 5_000);
    if (result.connected !== true || (requireWorld && result.inWorld !== true)) throw new Error('mc-pilot readiness result did not confirm the required world connection');
    return result;
  }

  async control<T = Record<string, unknown>>(action: string, params: Record<string, unknown> = {}, timeoutMs = this.options.requestTimeoutMs ?? 30_000): Promise<T> {
    if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u.test(action)) throw new Error('Invalid mc-pilot protocol action');
    if (action === 'capture.screenshot' || action === 'gui.screenshot') {
      const output = String(params.output ?? '');
      const root = resolve(this.options.runDir, 'screenshots');
      if (dirname(resolve(output)) !== root || !/^[a-zA-Z0-9_-]+\.png$/u.test(basename(output))) throw new Error('mc-pilot screenshot output must be inside this Run screenshot directory');
    }
    return this.request('control', { action, params, timeoutSeconds: Math.ceil(timeoutMs / 1000) }, timeoutMs + 2_000);
  }

  async screenshot(name: string, timeoutMs = 30_000): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+\.png$/u.test(name)) throw new Error('Screenshot name must be a simple PNG filename');
    const dir = join(this.options.runDir, 'screenshots'); await mkdir(dir, { recursive: true });
    const output = resolve(dir, name);
    await this.control('capture.screenshot', { output, gui: false }, timeoutMs);
    const image = await readFile(output);
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('mc-pilot did not produce a PNG screenshot');
    return output;
  }

  async stop(): Promise<ProcessResult | undefined> {
    if (this.stopped) return this.process;
    let failure: unknown;
    try { if (this.ready && !this.controller.signal.aborted && !this.options.signal?.aborted) await this.request('stop', {}, this.options.stopTimeoutMs ?? 30_000); }
    catch (error) { failure = error; this.controller.abort(); }
    finally { this.stopped = true; if (!this.process) this.controller.abort(); }
    const result = await this.process;
    if (failure) throw failure;
    // Explicit caller cancellation already requested disposal of the owning
    // process tree. A completed cancellation is successful cleanup; request
    // deadlines and unrelated broker failures still remain cleanup failures.
    if (result && result.status !== 'passed' && !(result.status === 'cancelled' && this.options.signal?.aborted)) throw new Error(`mc-pilot cleanup did not finish normally: ${result.status}`);
    return result;
  }
}


