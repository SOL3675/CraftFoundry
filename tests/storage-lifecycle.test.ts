import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClientSmoke } from '../dist/adapters/test/multiplayer.js';
import { McPilotRuntimeAdapter } from '../dist/adapters/runtime/mc-pilot.js';
import { OwnedServer } from '../dist/adapters/runtime/server.js';
import { inventoryStorage } from '../dist/core/storage.js';
import type { LoadedConfig } from '../src/core/types.ts';

for (const cleanup of ['retain', 'after-suite'] as const) test(`managed ${cleanup} shutdown attestation waits for all evidence retention, and an evidence failure keeps the unit active`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'Foundry evidence gate ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loaded: LoadedConfig = { root, config: { schemaVersion: 1, projectId: 'evidence-gate', builds: {},
    targets: { fabric: { minecraft: '1.21.1', loader: 'fabric', build: 'main', tasks: {}, artifactManifest: 'manifest.json', requiredSuites: [], java: { game: 'dummy' } } }, suites: {}, runtimes: {} },
    local: { schemaVersion: 1, storage: { managedCaches: true, cleanup }, java: { dummy: root } }, lock: { schemaVersion: 1, tools: {} } };
  const processResult = { status: 'passed' as const, exitCode: 0, signal: null, durationMs: 0, stdout: '', stderr: '', logs: { stdout: join(root, 'stdout.log'), stderr: join(root, 'stderr.log') } };
  await writeFile(processResult.logs.stdout, 'retained'); await writeFile(processResult.logs.stderr, '');
  for (const method of ['prepare', 'start', 'waitReady'] as const) t.mock.method(OwnedServer.prototype, method, async () => {});
  let failServerStop = false;
  let failServerEvidence = false;
  t.mock.method(OwnedServer.prototype, 'stop', async () => failServerStop ? { ...processResult, error: 'Stop confirmation failed despite exit zero' } : processResult);
  t.mock.method(OwnedServer.prototype, 'collectEvidence', async () => {
    if (failServerEvidence) throw new Error('Retained server evidence write failed');
    return [];
  });
  let failEvidence = true;
  t.mock.method(McPilotRuntimeAdapter.prototype, 'create', async function(this: McPilotRuntimeAdapter) {
    await mkdir(join(this.cache, 'client/runtime/libraries'), { recursive: true });
    await writeFile(join(this.cache, 'client/runtime/libraries/dependency.jar'), 'dependency');
    await mkdir(join(this.home, 'logs'), { recursive: true });
    const log = join(this.home, 'logs/client-smoke-client.log');
    if (failEvidence) await mkdir(log);
    else await writeFile(log, 'retained client evidence');
    return { name: 'smoke-client', minecraftDir: join(this.home, 'clients/smoke-client/minecraft'), modsDir: join(this.home, 'mods'), helperJar: join(this.home, 'helper.jar'), helperSha256: '0'.repeat(64), wsPort: 12345 };
  });
  t.mock.method(McPilotRuntimeAdapter.prototype, 'deployMod', async () => ({ path: 'fixture.jar', sha256: '0'.repeat(64) }));
  t.mock.method(McPilotRuntimeAdapter.prototype, 'launchWithoutHelper', async () => { throw new Error('Deliberate gameplay failure before evidence retention'); });
  t.mock.method(McPilotRuntimeAdapter.prototype, 'stop', async () => processResult);
  const handles: any[] = [];
  const run = (name: string) => runClientSmoke(loaded, 'fabric', { kind: 'server', capabilities: [] }, [{ path: 'fixture.jar', sha256: '0'.repeat(64), size: 1, kind: 'distribution', side: 'both', originalPath: 'fixture.jar' }], root, join(root, '.harness/runs', name, 'sessions/client'), {
    backendRoot: root, helperArtifact: { path: 'helper.jar', sha256: '0'.repeat(64) }, onStorageUnitStopped: unit => handles.push(unit), onStorageLeaseStopped: (reservation, lease) => handles.push({ reservation, lease }),
  });
  await assert.rejects(run('evidence-failed'), /not a regular owned log/);
  assert.equal(handles.length, 0, 'no attestation may escape a failed evidence-retention phase');
  let inventory = await inventoryStorage(root);
  assert.equal(inventory.reclaimableBytes, 0);
  assert.ok(inventory.entries.some(item => item.path.endsWith('dependency.jar') && item.disposition === 'retain'));
  failEvidence = false;
  failServerEvidence = true;
  const evidenceFailure = await run('server-evidence-failed');
  assert.equal(evidenceFailure.cases.at(-1)?.status, 'infrastructure-error');
  assert.equal(handles.length, 0, 'a caught server-evidence error must not attest completion');
  failServerEvidence = false;
  failServerStop = true;
  const stopFailure = await run('server-stop-unconfirmed');
  assert.equal(stopFailure.cases.at(-1)?.status, 'infrastructure-error');
  assert.equal(handles.length, 0, 'exit zero does not override a failed process disposal confirmation');
  failServerStop = false;
  const result = await run('evidence-complete');
  assert.equal(handles.length, 1, 'a stopped unit is reported after evidence retention completes');
  if (cleanup === 'after-suite') assert.equal(handles[0].lease.unitId, handles[0].reservation.id);
  assert.ok(result.logs.some(file => file.endsWith('client-smoke-client.log')));
  assert.ok(result.cases.some(item => item.status === 'infrastructure-error'));
  inventory = await inventoryStorage(root);
  assert.equal(inventory.reclaimableBytes, 0, 'shutdown alone still needs sealed and durably attached evidence');
  const log = inventory.entries.find(item => item.path.endsWith('client-smoke-client.log') && item.kind === 'file');
  assert.ok(log);
  assert.equal(await readFile(join(root, log.path), 'utf8'), 'retained client evidence');
});
