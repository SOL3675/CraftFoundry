import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertHelperFreeFixtureLog, fixtureStateFromChat, runFixtureMultiplayer, runFixtureMultiClient, FIXTURE_MULTIPLAYER_CASE_IDS, FIXTURE_MULTI_CLIENT_CASE_IDS, isFixtureTargetSupported, fixtureCapabilities } from '../dist/adapters/test/multiplayer.js';

test('helper-free loaded Mod evidence recognizes Forge debug records and rejects candidates or loaded helpers', () => {
  const fixture = '[main/DEBUG] [ModFileInfo/LOADING]: Found valid mod file f76f-harness-fixture-forge-0.1.0.jar with {fixture} mods - versions {0.1.0}';
  assert.doesNotThrow(() => assertHelperFreeFixtureLog(fixture));
  assert.doesNotThrow(() => assertHelperFreeFixtureLog(' - fixture 0.1.0\n'));
  assert.doesNotThrow(() => assertHelperFreeFixtureLog('Found mod file "f76f-harness-fixture-neoforge-0.1.0.jar"'));
  assert.throws(() => assertHelperFreeFixtureLog('Considering mod file candidate f76f-harness-fixture-forge-0.1.0.jar'), /Fixture distribution/u);
  assert.throws(() => assertHelperFreeFixtureLog(fixture + '\nFound valid mod file b93c-mct-client-mod-forge-1.20.1.jar with {mct} mods - versions {0.9.1}'), /Automation helper/u);
  assert.throws(() => assertHelperFreeFixtureLog(' - fixture 0.1.0\n - mct 0.9.1\n'), /Automation helper/u);
});

test('fixture observations select the most recent client state and preserve unsynchronized values', () => {
  const state = fixtureStateFromChat({ messages: [
    { plain: 'MCH_FIXTURE_CLIENT {"counter":0,"guiCounter":null,"screen":"none"}' },
    { plain: 'MCH_FIXTURE_SERVER {"counter":1}' },
    { content: 'MCH_FIXTURE_CLIENT {"counter":0,"guiCounter":1,"screen":"counter"}' },
  ] });
  assert.deepEqual(state, { counter: 0, guiCounter: 1, screen: 'counter' });
  assert.equal(fixtureStateFromChat({ messages: [{ plain: 'Ordinary chat' }] }), undefined);
});

test('malformed fixture observations cannot be accepted as successful state', () => {
  assert.throws(() => fixtureStateFromChat({ messages: [{ plain: 'MCH_FIXTURE_CLIENT {"counter":"1","guiCounter":1,"screen":"counter"}' }] }), /Invalid fixture/u);
  assert.throws(() => fixtureStateFromChat({ messages: [{ plain: 'MCH_FIXTURE_CLIENT {"counter":1,"guiCounter":1,"screen":"unrecognized"}' }] }), /Invalid fixture/u);
});

test('unverified target combinations produce explicit unsupported cases without launching a backend', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mch unsupported ')); t.after(() => rm(dir, { recursive: true, force: true }));
  const loaded = { root: dir, config: { schemaVersion: 1 as const, projectId: 'fixture', builds: {}, targets: { other: { minecraft: '1.19.4', loader: 'fabric' as const, build: 'main', tasks: {}, artifactManifest: 'build.json', requiredSuites: [] } }, suites: {}, runtimes: {} }, local: { schemaVersion: 1 as const }, lock: { schemaVersion: 1 as const, tools: {} } };
  const result = await runFixtureMultiplayer(loaded, 'other', { kind: 'server', capabilities: [] }, [], dir, join(dir, 'session'), { backendRoot: 'does-not-exist', helperArtifact: { path: 'does-not-exist', sha256: '0'.repeat(64) } });
  assert.deepEqual(result.cases.map(item => item.id), [...FIXTURE_MULTIPLAYER_CASE_IDS]);
  assert.ok(result.cases.every(item => item.status === 'unsupported'));
  assert.deepEqual(result.logs, []);
  const peerResult = await runFixtureMultiClient(loaded, 'other', { kind: 'server', capabilities: [] }, [], dir, join(dir, 'peer-session'), { backendRoot: 'does-not-exist', helperArtifact: { path: 'does-not-exist', sha256: '0'.repeat(64) } });
  assert.deepEqual(peerResult.cases.map(item => item.id), [...FIXTURE_MULTI_CLIENT_CASE_IDS]);
  assert.ok(peerResult.cases.every(item => item.status === 'unsupported'));
  assert.equal(peerResult.metadata.clients, 2);
  await assert.rejects(runFixtureMultiplayer(loaded, 'other', { kind: 'server', capabilities: [] }, [], dir, join(dir, 'invalid-session'), { backendRoot: 'does-not-exist', helperArtifact: { path: 'does-not-exist', sha256: '0'.repeat(64) }, clients: 3 }), /one or two clients/u);
});

test('verified fixture target registry does not infer support from a loader or game version alone', () => {
  assert.equal(isFixtureTargetSupported({ loader: 'fabric', minecraft: '1.21.1' }), true);
  assert.equal(isFixtureTargetSupported({ loader: 'fabric', minecraft: '1.20.1', loaderVersion: '0.16.14' }), true);
  assert.deepEqual(fixtureCapabilities({ loader: 'fabric', minecraft: '1.20.1', loaderVersion: '0.16.14' }), ['real-client', 'fixture-observation', 'multi-client', 'helper-free']);
  assert.deepEqual(fixtureCapabilities({ loader: 'forge', minecraft: '1.20.1' }), []);
  assert.equal(isFixtureTargetSupported({ loader: 'forge', minecraft: '1.20.1', loaderVersion: '47.3.0' }), true);
  assert.equal(isFixtureTargetSupported({ loader: 'forge', minecraft: '1.20.1', loaderVersion: '47.3.1' }), false);
  assert.equal(isFixtureTargetSupported({ loader: 'neoforge', minecraft: '1.21.1' }), false);
  assert.equal(isFixtureTargetSupported({ loader: 'neoforge', minecraft: '1.21.1', loaderVersion: '21.1.252' }), true);
  assert.equal(isFixtureTargetSupported({ loader: 'neoforge', minecraft: '1.21.1', loaderVersion: '21.1.235' }), false);
  assert.equal(isFixtureTargetSupported({ loader: 'fabric', minecraft: '1.21.1', loaderVersion: '0.16.13' }), false);
  assert.equal(isFixtureTargetSupported({ loader: 'fabric', minecraft: '1.21.2' }), false);
  assert.equal(isFixtureTargetSupported(undefined), false);
});
