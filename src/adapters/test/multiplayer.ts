import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Artifact, LoadedConfig, RuntimeConfig } from '../../core/types.js';
import type { TestCase } from '../../reporting/types.js';
import { redactText } from '../../reporting/redact.js';
import { collectCrashReports } from '../../reporting/evidence.js';
import { OwnedServer } from '../runtime/server.js';
import { McPilotRuntimeAdapter } from '../runtime/mc-pilot.js';
import { assertContainedPath } from '../../core/paths.js';

export const FIXTURE_MULTIPLAYER_CASE_IDS = ['multiplayer.connected', 'multiplayer.placed', 'multiplayer.gui', 'multiplayer.sync', 'multiplayer.reconnected', 'multiplayer.stopped'] as const;
export const FIXTURE_MULTI_CLIENT_CASE_IDS = ['multi-client.connected', 'multi-client.placed', 'multi-client.gui', 'multi-client.sync', 'multi-client.peer-sync', 'multi-client.reconnected', 'multi-client.stopped'] as const;
export const CLIENT_SMOKE_CASE_IDS = ['client.helper-free', 'client.joined', 'client.stopped'] as const;
export const VERIFIED_FIXTURE_TARGETS = [{ loader: 'fabric', minecraft: '1.20.1', loaderVersion: '0.16.14' }, { loader: 'fabric', minecraft: '1.21.1', loaderVersion: '0.16.14' }, { loader: 'neoforge', minecraft: '1.21.1', loaderVersion: '21.1.252' }, { loader: 'forge', minecraft: '1.20.1', loaderVersion: '47.3.0' }] as const;
export function isFixtureTargetSupported(target: { loader: string; minecraft: string; loaderVersion?: string } | undefined): target is { loader: string; minecraft: string; loaderVersion?: string } {
  return !!target && VERIFIED_FIXTURE_TARGETS.some(item => item.loader === target.loader && item.minecraft === target.minecraft && (target.loaderVersion === item.loaderVersion || (target.loader === 'fabric' && target.loaderVersion === undefined)));
}
export function fixtureCapabilities(target: { loader: string; minecraft: string; loaderVersion?: string } | undefined): string[] {
  return isFixtureTargetSupported(target) ? ['real-client', 'fixture-observation', 'multi-client', 'helper-free'] : [];
}
export interface PilotTestOptions {
  backendRoot: string;
  helperArtifact: { path: string; sha256: string };
  signal?: AbortSignal;
  /** Results use paths relative to the enclosing report directory. */
  reportRoot?: string;
  /** One client exercises its GUI; two clients additionally verify peer updates. */
  clients?: number;
  /** Optional immutable assets/objects seed; all copied objects are hash checked. */
  assetCache?: string;
}
export interface PilotTestResult { cases: TestCase[]; logs: string[]; evidence: string[]; metadata: Record<string, unknown> }

class FixtureConditionError extends Error {}
async function waitFor<T>(label: string, read: () => Promise<T>, matches: (value: T) => boolean, timeout: number, signal?: AbortSignal, readiness = false): Promise<T> {
  const end = Date.now() + timeout;
  let value: T | undefined;
  while (Date.now() < end) {
    if (signal?.aborted) throw new Error('Game test cancelled');
    value = await read();
    if (matches(value)) return value;
    await new Promise<void>(accept => setTimeout(accept, 100));
  }
  const message = `${label} did not reach the expected state within ${timeout} ms; last=${JSON.stringify(value)}`;
  if (readiness) throw new Error(message);
  throw new FixtureConditionError(message);
}
async function availablePort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to reserve a loopback port');
    return address.port;
  } finally { if (server.listening) await new Promise<void>(accept => server.close(() => accept())); }
}

/** This read-only fixture protocol is separate from the mc-pilot helper. */
export function fixtureStateFromChat(chat: unknown): { counter: number | null; guiCounter: number | null; screen: string } | undefined {
  const messages = (chat as { messages?: Array<Record<string, unknown>> })?.messages;
  if (!Array.isArray(messages)) return undefined;
  for (const message of messages.slice().reverse()) {
    const text = String(message.plain ?? message.content ?? '');
    const marker = 'MCH_FIXTURE_CLIENT ';
    const index = text.indexOf(marker);
    if (index >= 0) {
      const state = JSON.parse(text.slice(index + marker.length).trim());
      if (!(state.counter === null || Number.isInteger(state.counter)) || !(state.guiCounter === null || Number.isInteger(state.guiCounter)) || !['none', 'counter', 'other'].includes(state.screen)) throw new FixtureConditionError('Invalid fixture client state response');
      return state;
    }
  }
  return undefined;
}

/** Loader evidence must identify a loaded fixture and reject a loaded automation helper. */
export function assertHelperFreeFixtureLog(loadedMods: string): void {
  assert.doesNotMatch(loadedMods, /^\s*-\s+mct\s|Found mod file "mct-client-mod-|(?:^|[,\s])mod\/mct\b|Found valid mod file [^\r\n]*with \{[^}]*\bmct\b[^}]*\} mods/gmu, 'Automation helper was loaded in the helper-free distribution smoke');
  assert.match(loadedMods, /^\s*-\s+fixture\s|mod\/fixture\b|Found mod file "[^"]*harness-fixture|Found valid mod file [^\s"]*harness-fixture[^\s"]* with \{fixture\} mods/gmu, 'Fixture distribution did not appear in the actual client loaded-Mod log');
}

async function runPilotTest(loaded: LoadedConfig, targetId: string, runtime: RuntimeConfig, artifacts: Artifact[], artifactRoot: string, sessionRoot: string, options: PilotTestOptions, smoke: boolean): Promise<PilotTestResult> {
  const multi = !smoke && options.clients === 2;
  if (options.clients !== undefined && ![1, 2].includes(options.clients)) throw new Error('Fixture scenarios support one or two clients');
  const ids = smoke ? CLIENT_SMOKE_CASE_IDS : multi ? FIXTURE_MULTI_CLIENT_CASE_IDS : FIXTURE_MULTIPLAYER_CASE_IDS;
  const cases: TestCase[] = ids.map(id => ({ id, status: 'skipped', message: 'Earlier prerequisites did not complete' }));
  const root = options.reportRoot ?? sessionRoot;
  const reportPath = (file: string) => relative(root, file).replaceAll('\\', '/');
  const logs: string[] = []; const evidence: string[] = [];
  const metadata: Record<string, unknown> = { backend: 'mc-pilot', version: '0.15.0', helperEnabled: !smoke, fixtureScenario: !smoke, clients: multi ? 2 : 1, seed: 8675309, language: 'en_us', automaticRetries: 0 };
  const trace: Array<{ at: string; event: string; data: unknown }> = [];
  await mkdir(sessionRoot, { recursive: true });
  const traceFile = join(sessionRoot, 'actions.json'); evidence.push(reportPath(traceFile));
  const portable = (value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith(resolve(sessionRoot))) return reportPath(value);
    if (Array.isArray(value)) return value.map(portable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portable(item)]));
    return value;
  };
  const record = async (event: string, data: unknown) => { trace.push({ at: new Date().toISOString(), event, data: portable(data) }); await writeFile(traceFile, redactText(JSON.stringify(trace, null, 2))); };
  const target = loaded.config.targets[targetId];
  if (!isFixtureTargetSupported(target)) {
    return { cases: cases.map(item => ({ ...item, status: 'unsupported', message: 'The fixture scenario is verified for Fabric 0.16.14 on Minecraft 1.20.1/1.21.1 or explicitly pinned NeoForge 21.1.252 on Minecraft 1.21.1' })), logs, evidence: [], metadata };
  }
  const javaRole = target.java?.game; const javaHome = javaRole ? loaded.local.java?.[javaRole] : undefined;
  let current = 0; let started = performance.now();
  const passed = () => { const item = cases[current]!; item.status = 'passed'; item.message = undefined; item.durationMs = performance.now() - started; current++; started = performance.now(); };
  const server = new OwnedServer(loaded, targetId, runtime, join(sessionRoot, 'server'), join(sessionRoot, 'server-process'));
  let client: McPilotRuntimeAdapter | undefined;
  let peer: McPilotRuntimeAdapter | undefined;
  const conditionTimeout = Math.min(loaded.local.timeouts?.test ?? 30_000, 30_000);
  const username = smoke ? 'MchSmoke' : 'MchTest';
  try {
    if (!javaHome) throw new Error('A game Java role with an explicit local home is required');
    const wsPort = await availablePort();
    const makeClient = (directory: string, name: string, account: string, port: number) => new McPilotRuntimeAdapter({ backendRoot: options.backendRoot, runDir: join(sessionRoot, directory), clientName: name, minecraft: target!.minecraft, loader: target!.loader as 'fabric' | 'forge' | 'neoforge', loaderVersion: target.loaderVersion, downloadConcurrency: process.platform === 'linux' ? 2 : undefined, assetCache: options.assetCache, java: join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), wsPort: port, account, helperArtifact: options.helperArtifact, signal: options.signal, requestTimeoutMs: loaded.local.timeouts?.build ?? 600_000, sessionTimeoutMs: loaded.local.timeouts?.test ?? 600_000, stopTimeoutMs: loaded.local.timeouts?.stop ?? 30_000, redact: redactText });
    client = makeClient('client', smoke ? 'smoke-client' : 'fixture-client', username, wsPort);
    await server.prepare(artifacts, artifactRoot, options.signal); await server.start(options.signal); await server.waitReady();
    await record('server-ready', { port: server.port }); metadata.serverPort = server.port;
    const prepared = await client.create(); metadata.client = portable(prepared); metadata.wsPort = wsPort;
    if (multi) {
      let peerPort = await availablePort(); while (peerPort === wsPort) peerPort = await availablePort();
      peer = makeClient('peer', 'peer-client', 'MchPeer', peerPort);
      metadata.peer = portable(await peer.create()); metadata.peerWsPort = peerPort;
    }
    for (const artifact of artifacts.filter(item => ['distribution', 'runtime-dependency'].includes(item.kind) && ['both', 'client'].includes(item.side))) await client.deployMod(join(artifactRoot, artifact.path), artifact.sha256);
    if (peer) for (const artifact of artifacts.filter(item => ['distribution', 'runtime-dependency'].includes(item.kind) && ['both', 'client'].includes(item.side))) await peer.deployMod(join(artifactRoot, artifact.path), artifact.sha256);
    if (!artifacts.some(item => item.kind === 'distribution' && ['both', 'client'].includes(item.side))) throw new Error('A client-side distribution artifact is required');
    const address = `127.0.0.1:${server.port}`;
    if (smoke) {
      const before = (await readFile(join(server.directory, 'logs/latest.log'), 'utf8')).length;
      await record('launch-without-helper', await client.launchWithoutHelper(address)); passed();
      await waitFor('Actual helper-free client world join', async () => (await readFile(join(server.directory, 'logs/latest.log'), 'utf8')).slice(before), text => text.includes(`${username} joined the game`), loaded.local.timeouts?.start ?? 180_000, options.signal, true);
      let loadedMods = await readFile(join(client.home, 'logs', 'client-smoke-client.log'), 'utf8');
      // Forge 47.3.0 records its validated Mod list only in the actual game's debug log.
      if (target.loader === 'forge') loadedMods += '\n' + await readFile(join(prepared.minecraftDir, 'logs', 'debug.log'), 'utf8');
      assertHelperFreeFixtureLog(loadedMods);
      await record('helper-free-world-joined', { account: username }); passed();
    } else {
      const action = async <T = Record<string, any>>(name: string, params: Record<string, unknown> = {}, selected = client!): Promise<T> => { const value = await selected.control<T>(name, params, conditionTimeout); await record(name, { client: selected === peer ? 'MchPeer' : username, params, result: value }); return value; };
      const clientState = async (selected = client!) => {
        await action('chat.clear', {}, selected); await action('chat.command', { command: 'fixture_client state 0 -60 0' }, selected);
        const chat = await waitFor('Fixture read-only client response', () => selected.control('chat.history', { last: 10 }), value => fixtureStateFromChat(value) !== undefined, conditionTimeout, options.signal);
        return fixtureStateFromChat(chat)!;
      };
      const serverState = async () => {
        const file = join(server.directory, 'logs/latest.log'); const before = (await readFile(file, 'utf8')).length;
        server.command('fixture state 0 -60 0');
        const value = await waitFor('Fixture read-only server response', async () => { const text = (await readFile(file, 'utf8')).slice(before); const match = /MCH_FIXTURE_SERVER (\{[^\r\n]*\})/u.exec(text); return match ? JSON.parse(match[1]!) as { counter: number } : undefined; }, value => value !== undefined, conditionTimeout, options.signal);
        await record('server-state', value); return value!;
      };
      // World setup and inventory are prerequisites. Placement and interaction
      // below always use the actual player interaction manager, never setblock.
      server.command(`op ${username}`); server.command('time set day'); server.command('gamerule doDaylightCycle false'); server.command('gamerule doWeatherCycle false'); server.command('weather clear');
      await record('client-launch', await client.launch(address)); await record('client-world-ready', await client.waitReady(loaded.local.timeouts?.start ?? 180_000));
      if (peer) {
        server.command('op MchPeer');
        await record('peer-launch', await peer.launch(address)); await record('peer-world-ready', await peer.waitReady(loaded.local.timeouts?.start ?? 180_000));
        server.command('gamemode creative MchPeer'); server.command('tp MchPeer 1.5 -60 3.5');
        await waitFor('Peer start position', () => peer!.control<Record<string, number>>('position.get'), p => Math.abs(p.x! - 1.5) < 0.1 && Math.abs(p.y! + 60) < 0.2 && Math.abs(p.z! - 3.5) < 0.1, conditionTimeout, options.signal);
        await waitFor('Peer loaded terrain and playable HUD', () => peer!.control<Record<string, any>>('status.all'), state => state.inWorld === true && state.position?.onGround === true && state.screen?.open === false, conditionTimeout, options.signal);
      }
      server.command(`gamemode creative ${username}`); server.command(`tp ${username} 0.5 -60 3.5`); server.command(`give ${username} fixture:counter 1`);
      await waitFor('Player start position', () => client!.control<Record<string, number>>('position.get'), p => Math.abs(p.x! - 0.5) < 0.1 && Math.abs(p.y! + 60) < 0.2 && Math.abs(p.z! - 3.5) < 0.1, conditionTimeout, options.signal);
      await waitFor('Loaded terrain and playable HUD', () => client!.control<Record<string, any>>('status.all'), state => state.inWorld === true && state.position?.onGround === true && state.screen?.open === false, conditionTimeout, options.signal); passed();
      await action('inventory.hotbar', { slot: 0 }); await waitFor('Held fixture item', () => client!.control('inventory.held'), held => JSON.stringify(held).includes('fixture:counter'), conditionTimeout, options.signal);
      await action('look.at', { x: 0.5, y: -59.5, z: 0.5 }); assert.equal((await action('block.get', { x: 0, y: -60, z: 0 })).type, 'minecraft:air');
      const placed = await action('block.place', { x: 0, y: -60, z: 0, face: 'up' }); assert.equal(placed.success, true); assert.equal(placed.placedType, 'fixture:counter');
      assert.equal((await serverState()).counter, 0); assert.equal((await clientState()).counter, 0); evidence.push(reportPath(await client.screenshot('placed.png'))); passed();
      assert.equal((await action('block.interact', { x: 0, y: -60, z: 0 })).success, true);
      await waitFor('Counter GUI', () => client!.control<Record<string, unknown>>('gui.info'), info => info.open === true && info.handlerType === 'fixture:counter' && info.type === 'CounterScreen', conditionTimeout, options.signal); passed();
      assert.equal((await serverState()).counter, 1);
      const synced = await waitFor('Server, client entity and GUI synchronization', clientState, state => state.counter === 1 && state.guiCounter === 1 && state.screen === 'counter', conditionTimeout, options.signal); await record('synced-state', synced); evidence.push(reportPath(await client.screenshot('counter-gui.png'))); passed();
      if (peer) {
        const syncedPeer = await waitFor('Peer block entity synchronization', () => clientState(peer!), state => state.counter === 1, conditionTimeout, options.signal);
        assert.equal(syncedPeer.guiCounter, null, 'Peer must observe the block entity without opening its GUI');
        await record('peer-synced-state', syncedPeer); await action('look.at', { x: 0.5, y: -59.5, z: 0.5 }, peer);
        evidence.push(reportPath(await peer.screenshot('peer-synced.png'))); passed();
      }
      await action('gui.close'); server.command('save-all flush');
      const reconnecting = peer ?? client;
      const mark = server.mark();
      await action('client.reconnect', { address }, reconnecting); await reconnecting.waitReady(loaded.local.timeouts?.start ?? 180_000);
      await server.waitForOutput(new RegExp(`${peer ? 'MchPeer' : username} joined the game`, 'u'), loaded.local.timeouts?.start ?? 180_000, mark);
      assert.equal((await serverState()).counter, 1);
      const reconnected = await waitFor('Reconnected block entity state', () => clientState(reconnecting), state => state.counter === 1, conditionTimeout, options.signal);
      await record('reconnected-state', reconnected);
      if (peer) assert.equal((await clientState()).counter, 1);
      evidence.push(reportPath(await reconnecting.screenshot('reconnected.png'))); passed();
    }
  } catch (error) {
    const item = cases[Math.min(current, cases.length - 2)]!;
    item.status = error instanceof assert.AssertionError || error instanceof FixtureConditionError ? 'failed' : 'infrastructure-error'; item.message = (error as Error).message; item.durationMs = performance.now() - started;
    await record('failure', { case: item.id, status: item.status, message: item.message });
    if (client && !smoke) {
      try { await record('failure-state', await client.control('status.all', {}, 5_000)); evidence.push(reportPath(await client.screenshot('failure.png', 5_000))); }
      catch (failure) { await record('failure-evidence-unavailable', (failure as Error).message); }
    }
    if (peer) {
      try { await record('peer-failure-state', await peer.control('status.all', {}, 5_000)); evidence.push(reportPath(await peer.screenshot('failure.png', 5_000))); }
      catch (failure) { await record('peer-failure-evidence-unavailable', (failure as Error).message); }
    }
  } finally {
    const cleanup = cases.at(-1)!; const failures: string[] = [];
    for (const [name, selected] of [['Peer', peer], ['Client', client]] as const) {
      try { const result = await selected?.stop(); if (result) logs.push(reportPath(result.logs.stdout), reportPath(result.logs.stderr)); }
      catch (error) { failures.push(`${name} cleanup: ${(error as Error).message}`); }
    }
    try {
      const result = await server.stop();
      if (result) { logs.push(reportPath(result.logs.stdout), reportPath(result.logs.stderr)); if (result.exitCode !== 0) failures.push(`Server cleanup ended with ${result.status}, exit ${result.exitCode}`); }
      for (const file of await server.collectEvidence()) evidence.push(reportPath(join(server.directory, file)));
    } catch (error) { failures.push(`Server cleanup: ${(error as Error).message}`); }
    cleanup.status = failures.length ? 'infrastructure-error' : 'passed'; cleanup.message = failures.length ? failures.join('; ') : undefined;
    await record('cleanup', cleanup);
    // The backend's own client log is separate from broker stdout. Sanitize it
    // before exposing the retained evidence; offline fixtures use no login token.
    for (const [name, selected] of [[smoke ? 'smoke-client' : 'fixture-client', client], ['peer-client', peer]] as const) {
      if (!selected) continue;
      const minecraft = join(selected.home, 'clients', name, 'minecraft');
      for (const file of await collectCrashReports(minecraft)) evidence.push(reportPath(join(minecraft, file)));
      const clientLogs = [join(selected.home, 'logs', `client-${name}.log`)];
      if (target.loader === 'forge') clientLogs.push(join(selected.home, 'clients', name, 'minecraft', 'logs', 'debug.log'));
      for (const clientLog of clientLogs) {
        try {
          await assertContainedPath(selected.home, clientLog);
          if (!(await lstat(clientLog)).isFile()) throw new Error('Client evidence is not a regular owned log');
          const content = await readFile(clientLog, 'utf8');
          await assertContainedPath(selected.home, clientLog);
          if (!(await lstat(clientLog)).isFile()) throw new Error('Client evidence changed before redaction');
          await writeFile(clientLog, redactText(content)); logs.push(reportPath(clientLog));
        }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
  }
  return { cases, logs: [...new Set(logs)], evidence: [...new Set(evidence)], metadata };
}

export function runFixtureMultiplayer(loaded: LoadedConfig, targetId: string, runtime: RuntimeConfig, artifacts: Artifact[], artifactRoot: string, sessionRoot: string, options: PilotTestOptions): Promise<PilotTestResult> {
  return runPilotTest(loaded, targetId, runtime, artifacts, artifactRoot, sessionRoot, options, false);
}
export function runClientSmoke(loaded: LoadedConfig, targetId: string, runtime: RuntimeConfig, artifacts: Artifact[], artifactRoot: string, sessionRoot: string, options: PilotTestOptions): Promise<PilotTestResult> {
  return runPilotTest(loaded, targetId, runtime, artifacts, artifactRoot, sessionRoot, options, true);
}
export function runFixtureMultiClient(loaded: LoadedConfig, targetId: string, runtime: RuntimeConfig, artifacts: Artifact[], artifactRoot: string, sessionRoot: string, options: PilotTestOptions): Promise<PilotTestResult> {
  return runPilotTest(loaded, targetId, runtime, artifacts, artifactRoot, sessionRoot, { ...options, clients: 2 }, false);
}


