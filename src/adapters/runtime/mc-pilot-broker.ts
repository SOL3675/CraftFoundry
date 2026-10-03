// This is a persistent owner of one mc-pilot client. It uses fixed backend APIs
// and applies a local process-control policy without modifying upstream files.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { createInterface } from 'node:readline';
import { readFile, mkdir, cp, writeFile, symlink, access } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import type { ChildProcess, spawn as Spawn } from 'node:child_process';

interface Request { id: string; operation: string; params: Record<string, any> }
interface Settings { backendRoot: string; home: string; cache: string; clientName: string; downloadConcurrency?: number; nativeOwner?: string }
const settings = JSON.parse(process.argv[2] ?? '{}') as Settings;
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const fail = (error: unknown, depth = 0): string => {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  const parts = [error.message || error.name, ...(code ? [`code=${code}`] : [])];
  if (depth < 3) {
    if (error.cause !== undefined) parts.push(`cause: ${fail(error.cause, depth + 1)}`);
    if (error instanceof AggregateError) for (const nested of error.errors.slice(0, 8)) parts.push(fail(nested, depth + 1));
  }
  return parts.join('; ');
};

async function portAvailable(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('WebSocket port must be an integer from 1024 to 65535');
  await new Promise<void>((accept, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Client WebSocket port ${port} is occupied; refusing to terminate its listener`)));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(error => error ? reject(error) : accept()));
  });
}

async function main() {
  if (!settings.home || !settings.cache || !settings.backendRoot || !/^[a-zA-Z0-9_-]+$/u.test(settings.clientName)) throw new Error('Invalid mc-pilot broker settings');
  process.env.MCT_HOME = resolve(settings.home);
  process.env.MCT_CACHE_DIR = resolve(settings.cache);
  process.env.MCT_CLIENT_LANGUAGE = 'en_us';
  const metadata = JSON.parse(await readFile(join(settings.backendRoot, 'package.json'), 'utf8'));
  if (metadata.name !== '@kzheart_/mc-pilot' || metadata.version !== '0.15.0') throw new Error('mc-pilot package must be @kzheart_/mc-pilot version 0.15.0');

  // Keep launches inside the broker's process group / Windows Job Object.
  // ChildProcess handles identify ownership during this invocation; persisted
  // backend state and socket listeners cannot grant permission to kill a PID.
  const childProcesses = createRequire(import.meta.url)('node:child_process') as { spawn: typeof Spawn };
  const originalSpawn = childProcesses.spawn;
  const owned = new Map<number, ChildProcess>();
  let gameJava: string | undefined;
  childProcesses.spawn = ((executable: string, args: readonly string[], options: Record<string, unknown> = {}) => {
    // @xmcl's Forge/NeoForge installer invokes a literal `java`, even when
    // mc-pilot launch was given an explicit executable. Apply that same game
    // role to installer children without changing the user's PATH or Java.
    const selected = gameJava && (executable === 'java' || executable === 'java.exe') ? gameJava : executable;
    const isLauncher = process.platform === 'win32' && selected === process.execPath && args[0] === join(dirname(settings.home), 'backend-overlay', 'scripts', 'launch-fabric-client.mjs');
    const launchArgs = isLauncher ? ['--import', new URL('./native-launch-hook.js', import.meta.url).href, ...args] : args;
    const launchOptions = isLauncher ? { ...options, env: { ...(options.env as NodeJS.ProcessEnv), MCH_NATIVE_OWNER: settings.nativeOwner } } : options;
    const child = originalSpawn(selected, launchArgs, { ...launchOptions, detached: false, windowsHide: true });
    if (child.pid) { const pid = child.pid; owned.set(pid, child); child.once('exit', () => owned.delete(pid)); }
    return child;
  }) as typeof Spawn;
  syncBuiltinESMExports();

  const killOwned = (pid: number, signal: NodeJS.Signals = 'SIGTERM') => {
    const child = owned.get(pid);
    if (!child) throw new Error('mc-pilot attempted to stop a process not owned by this live broker');
    if (!child.kill(signal)) throw new Error('Unable to stop the owned mc-pilot launcher');
  };
  // The upstream implementation forcibly releases arbitrary listeners on a
  // requested port. Disable that policy. Port availability is checked before
  // launch and live sockets are contacted only through the selected client.
  const policy = { killProcessTree: killOwned, isProcessRunning: (pid: number) => owned.has(pid) };
  Object.assign(globalThis, { [Symbol.for('mch.mcPilot.processPolicy')]: policy });
  // The published npm 0.15.0 package predates upstream's Windows platform
  // module. Its ES module exports cannot be replaced at runtime. Create an
  // explicit session overlay with one replacement, keeping installed bytes
  // untouched and retaining the package's normal instance/API implementation.
  const overlay = join(dirname(settings.home), 'backend-overlay');
  await mkdir(overlay);
  for (const dir of ['dist', 'scripts', 'data']) await cp(join(settings.backendRoot, dir), join(overlay, dir), { recursive: true });
  await cp(join(settings.backendRoot, 'package.json'), join(overlay, 'package.json'));
  const nodeModules = dirname(dirname(settings.backendRoot));
  try { await access(join(nodeModules, '@xmcl')); await symlink(nodeModules, join(overlay, 'node_modules'), 'junction'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeFile(join(overlay, 'dist', 'util', 'process.js'), `const policy = globalThis[Symbol.for('mch.mcPilot.processPolicy')];
export const isProcessRunning = pid => policy.isProcessRunning(pid);
export const killProcessTree = (pid, signal = 'SIGTERM') => policy.killProcessTree(pid, signal);
export const getListeningPids = () => [];
export const isInProcessTree = (pid, rootPid) => pid === rootPid && policy.isProcessRunning(rootPid);
export const findPidsByCommandLine = () => [];
`);
  const replacedFiles = ['dist/util/process.js'];
  if (settings.downloadConcurrency !== undefined) {
    if (!Number.isInteger(settings.downloadConcurrency) || settings.downloadConcurrency < 1 || settings.downloadConcurrency > 16) throw new Error('Invalid installer download concurrency');
    const file = 'dist/download/client/FabricRuntimeDownloader.js';
    let source = await readFile(join(overlay, file), 'utf8');
    for (const key of ['assetsDownloadConcurrency', 'librariesDownloadConcurrency']) {
      const expected = `${key}: 16`;
      if (source.split(expected).length !== 2) throw new Error(`Pinned backend downloader contract changed: ${key}`);
      source = source.replace(expected, `${key}: ${settings.downloadConcurrency}`);
    }
    await writeFile(join(overlay, file), source); replacedFiles.push(file);
  }
  await writeFile(join(overlay, 'HARNESS-OVERLAY.json'), JSON.stringify({ backend: '@kzheart_/mc-pilot', version: metadata.version, replacedFile: 'dist/util/process.js', replacedFiles, downloadConcurrency: settings.downloadConcurrency, policy: 'live-owned-child-handles; no port-listener termination; no PID recovery', sourceRoot: settings.backendRoot }, null, 2));
  const load = (path: string) => import(pathToFileURL(join(overlay, 'dist', path)).href);
  const [{ ClientInstanceManager }, { GlobalStateStore }, { downloadClientModToDir }, { WebSocketClient }] = await Promise.all([
    load('instance/ClientInstanceManager.js'), load('util/global-state.js'), load('download/client/ClientDownloader.js'), load('client/WebSocketClient.js'),
  ]);
  const manager = new ClientInstanceManager(new GlobalStateStore());
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let created = false;
  let launched = false;
  let wsPort = 0;
  send({ event: 'ready', version: metadata.version, processPolicy: 'live-owned-handles' });
  for await (const line of input) {
    let request: Request;
    try { request = JSON.parse(line) as Request; }
    catch { throw new Error('Invalid broker protocol JSON'); }
    try {
      let data: unknown;
      switch (request.operation) {
        case 'create': {
          if (created) throw new Error('Client instance has already been created');
          if (typeof request.params.java !== 'string' || !isAbsolute(request.params.java)) throw new Error('Explicit absolute game Java is required for client installation');
          gameJava = request.params.java;
          wsPort = request.params.wsPort;
          await portAvailable(wsPort);
          const instanceDir = join(settings.home, 'clients', settings.clientName);
          await mkdir(instanceDir, { recursive: true });
          const loaderVersion = request.params.loaderVersion;
          let resolvedVariant: Record<string, any> | undefined;
          let catalogLoaderVersion: string | undefined;
          let expectedVersionId: string | undefined;
          const dependencies: Record<string, unknown> = {};
          if (loaderVersion !== undefined || settings.downloadConcurrency !== undefined) {
            if (loaderVersion !== undefined && (typeof loaderVersion !== 'string' || !/^\d+(?:\.\d+){1,3}(?:-[a-zA-Z0-9.]+)?$/u.test(loaderVersion))) throw new Error('Invalid explicit loader version');
            const { prepareManagedClientRuntime } = await load('download/client/FabricRuntimeDownloader.js');
            // The published API exposes this installer dependency but only a
            // Forge CLI override. Select the exact requested loader in memory;
            // keep the catalog and installed source files unchanged.
            dependencies.prepareManagedRuntimeImpl = async (variant: Record<string, any>, paths: unknown, installerDependencies: unknown) => {
              if (variant.loader !== request.params.loader || variant.minecraftVersion !== request.params.minecraft) throw new Error('Backend selected a different Minecraft/loader target');
              const field = variant.loader === 'fabric' ? 'fabricLoaderVersion' : variant.loader === 'forge' ? 'forgeVersion' : 'neoforgeVersion';
              catalogLoaderVersion = variant[field];
              const selectedVersion = loaderVersion ?? catalogLoaderVersion;
              resolvedVariant = { ...variant, [field]: selectedVersion };
              expectedVersionId = variant.loader === 'fabric' ? `${variant.minecraftVersion}-fabric${selectedVersion}` : variant.loader === 'forge' || variant.loomPlatform === 'forge' ? `${variant.minecraftVersion}-forge-${selectedVersion}` : `neoforge-${selectedVersion}`;
              const attempts = settings.downloadConcurrency !== undefined ? 3 : 1;
              for (let attempt = 1; ; attempt++) {
                try {
                  const installed = await prepareManagedClientRuntime(resolvedVariant, paths, installerDependencies);
                  if (installed.versionId !== expectedVersionId) throw new Error(`Installed client runtime ${installed.versionId} does not match requested loader ${expectedVersionId}`);
                  return installed;
                } catch (error) {
                  // @xmcl 6.1.2 swallows asset-index fallback fetch errors and
                  // destructures its undefined result. Identify that exact
                  // pinned-library failure while keeping unrelated TypeErrors
                  // fatal and preserving the original diagnostic.
                  const assetIndexFailure = error instanceof TypeError && error.message === "Cannot destructure property 'objects' of '(intermediate value)' as it is undefined.";
                  const detail = assetIndexFailure ? `Asset-index fetch fallback returned no data: ${fail(error)}` : fail(error);
                  if (attempt >= attempts || !(assetIndexFailure || /ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET/u.test(detail))) {
                    if (assetIndexFailure) throw new Error(detail, { cause: error });
                    throw error;
                  }
                  send({ event: 'download-retry', attempt: attempt + 1, error: detail });
                  await new Promise<void>(accept => setTimeout(accept, attempt * 1_000));
                }
              }
            };
          }
          const downloaded = await downloadClientModToDir(process.cwd(), instanceDir, { version: request.params.minecraft, loader: request.params.loader, java: request.params.java }, dependencies);
          if (loaderVersion !== undefined && (!resolvedVariant || downloaded.runtimeVersionId !== expectedVersionId)) throw new Error('Backend did not apply the explicit loader version');
          if (resolvedVariant) downloaded.variant = resolvedVariant;
          const meta = await manager.create({ name: settings.clientName, version: downloaded.minecraftVersion, loader: downloaded.loader, wsPort, account: request.params.account ?? 'HarnessPlayer', headless: false, mute: true, launchArgs: downloaded.launchArgs, javaCommand: downloaded.javaCommand, javaVersion: downloaded.javaVersion, env: { MCT_CLIENT_MOD_VARIANT: downloaded.variantId, MCT_CLIENT_MOD_JAR: downloaded.jar } });
          created = true;
          data = { ...meta, minecraftDir: downloaded.minecraftDir, modsDir: downloaded.modsDir, helperJar: downloaded.jar, runtimeRootDir: downloaded.runtimeRootDir, runtimeVersionId: downloaded.runtimeVersionId, variant: downloaded.variant, ...(loaderVersion ? { loaderVersion, catalogLoaderVersion } : {}) };
          break;
        }
        case 'launch':
          if (!created || launched) throw new Error('Client must be created once before launch');
          await portAvailable(wsPort);
          data = await manager.launch(settings.clientName, { server: request.params.server, account: request.params.account, wsPort, headless: false, mute: true, force: false });
          launched = true;
          break;
        case 'waitReady':
          if (!launched) throw new Error('Client has not been launched');
          data = await manager.waitReady(settings.clientName, request.params.timeoutSeconds, { requireWorld: request.params.requireWorld !== false });
          break;
        case 'control': {
          if (!launched) throw new Error('Client has not been launched');
          const entry = await manager.getClient(settings.clientName);
          const response = await new WebSocketClient(`ws://127.0.0.1:${entry.wsPort}`).send(request.params.action, request.params.params ?? {}, request.params.timeoutSeconds);
          if (response?.success !== true || response.error) throw new Error(`mc-pilot action failed: ${typeof response.error === 'string' ? response.error : JSON.stringify(response.error ?? response)}`);
          data = response.data;
          break;
        }
        case 'stop':
          data = launched ? await manager.stop(settings.clientName) : { stopped: false, alreadyStopped: true };
          send({ id: request.id, success: true, data });
          input.close(); process.stdin.destroy(); return;
        default: throw new Error(`Unsupported broker operation: ${request.operation}`);
      }
      send({ id: request.id, success: true, data });
    } catch (error) {
      send({ id: request.id, success: false, error: fail(error) });
      if (request.operation === 'stop') { input.close(); process.stdin.destroy(); return; }
    }
  }
}

main().catch(error => { send({ event: 'error', error: fail(error) }); process.exitCode = 1; });
