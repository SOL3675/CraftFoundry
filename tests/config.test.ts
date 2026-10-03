import test from 'node:test';
import assert from 'node:assert/strict';
import { realpath, mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, validateArtifactManifest, ConfigError } from '../dist/core/config.js';

function config() {
  return {
    schemaVersion: 1, projectId: 'example-mod',
    builds: { main: { root: '.', adapter: 'gradle' } },
    targets: { 'fabric-1.21.1': {
      minecraft: '1.21.1', loader: 'fabric', build: 'main',
      tasks: { build: [':fabric:build'], unit: [':fabric:test'] },
      artifactManifest: 'build/harness/fabric-1.21.1.json', requiredSuites: ['unit'],
      java: { gradle: 'jdk21', toolchain: 21, game: 'jdk21' },
    } },
    suites: { unit: { driver: 'gradle', task: 'unit', minTests: 1 } }, runtimes: {},
  };
}

async function project(t: { after: (fn: () => Promise<void>) => void }, value: unknown = config()) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mch 設定 test ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'harness.config.json'), JSON.stringify(value));
  return root;
}

test('loads shared contracts with optional machine config and lock defaults', async (t) => {
  const root = await project(t);
  const loaded = await loadConfig(root);
  assert.equal(loaded.root, root);
  assert.equal(loaded.config.targets['fabric-1.21.1'].java.toolchain, 21);
  assert.deepEqual(loaded.local, { schemaVersion: 1 });
  assert.deepEqual(loaded.lock, { schemaVersion: 1, tools: {} });
});

test('loads pinned lock and local Java roles without mutating shared required suites', async (t) => {
  const root = await project(t);
  await writeFile(path.join(root, 'harness.local.json'), JSON.stringify({ schemaVersion: 1, java: { jdk21: path.join(root, 'Java 21') }, timeouts: { test: 1000 }, eulaAccepted: true }));
  await writeFile(path.join(root, 'harness.lock.json'), JSON.stringify({ schemaVersion: 1, tools: { pilot: { version: '0.1.0', sha256: 'a'.repeat(64), url: 'https://example.org/pilot' } } }));
  const loaded = await loadConfig(root);
  assert.equal(loaded.local.eulaAccepted, true);
  assert.equal(loaded.lock.tools.pilot.version, '0.1.0');
  assert.deepEqual(loaded.config.targets['fabric-1.21.1'].requiredSuites, ['unit']);
});

test('per-version local asset caches require absolute paths without changing shared targets', async t => {
  const root = await project(t);
  await writeFile(path.join(root, 'harness.local.json'), JSON.stringify({ schemaVersion: 1, assetCaches: { '1.21.1': path.join(root, 'assets', 'objects') } }));
  assert.equal((await loadConfig(root)).local.assetCaches?.['1.21.1'], path.join(root, 'assets', 'objects'));
  await writeFile(path.join(root, 'harness.local.json'), JSON.stringify({ schemaVersion: 1, assetCaches: { '1.21.1': 'relative/objects' } }));
  await assert.rejects(loadConfig(root), /assetCaches.*absolute/u);
});

test('target suite bindings preserve shared assertions and reject missing runtimes and unpinned helpers', async (t) => {
  const value: any = config();
  value.runtimes.neo = { kind: 'server', capabilities: ['dedicated-server'] };
  value.targets['fabric-1.21.1'].suiteBindings = { unit: { runtime: 'neo' } };
  const root = await project(t, value);
  const loaded = await loadConfig(root);
  assert.equal(loaded.config.targets['fabric-1.21.1'].suiteBindings?.unit.runtime, 'neo');
  assert.equal(loaded.config.suites.unit.minTests, 1);
  value.targets['fabric-1.21.1'].suiteBindings.unit = { runtime: 'missing', pilot: { backend: 'pilot', helper: 'helper' } };
  await writeFile(path.join(root, 'harness.config.json'), JSON.stringify(value));
  await assert.rejects(loadConfig(root), /unknown runtime missing[\s\S]*must be pinned/);
  value.targets['fabric-1.21.1'].suiteBindings = { unknown: { runtime: 'neo' } };
  await writeFile(path.join(root, 'harness.config.json'), JSON.stringify(value));
  await assert.rejects(loadConfig(root), /unknown suite/);
});

test('local settings cannot override or disable required suites', async (t) => {
  const root = await project(t);
  await writeFile(path.join(root, 'harness.local.json'), JSON.stringify({ schemaVersion: 1, targets: {}, requiredSuites: [] }));
  await assert.rejects(loadConfig(root), (error) => error instanceof ConfigError && /harness.local.json.*additional properties/.test(error.message));
});

test('malformed files are diagnosed instead of being treated as absent', async (t) => {
  const root = await project(t);
  await writeFile(path.join(root, 'harness.lock.json'), '{broken');
  await assert.rejects(loadConfig(root), /harness.lock.json: invalid JSON/);
  await rm(path.join(root, 'harness.config.json'));
  await assert.rejects(loadConfig(root), /harness.config.json: cannot read file/);
});

test('aggregates missing build, suite, task, runtime and invalid pattern references', async (t) => {
  const value: any = config();
  value.targets['fabric-1.21.1'].build = 'missing';
  value.targets['fabric-1.21.1'].requiredSuites.push('nonexistent');
  value.suites.unit.task = 'missing';
  value.suites.smoke = { driver: 'process', runtime: 'missing' };
  value.runtimes.server = { kind: 'server', capabilities: [], readyPattern: '[' };
  await assert.rejects(loadConfig(await project(t, value)), (error) => {
    assert.ok(error instanceof ConfigError);
    for (const text of ['unknown build', 'unknown suite', 'missing task mapping', 'unknown runtime', 'invalid regular expression']) assert.match(error.message, new RegExp(text));
    assert.equal(error.diagnostics.length, 5);
    return true;
  });
});

test('validates supported lower bound while accepting explicit future target declarations', async (t) => {
  for (const version of ['1.19.4', '1.20', '1.20.0']) {
    const value = config(); value.targets['fabric-1.21.1'].minecraft = version;
    await assert.rejects(loadConfig(await project(t, value)), /lower bound 1.20.1/);
  }
  for (const version of ['1.20.1', '1.21.1', '26.1']) {
    const value = config(); value.targets['fabric-1.21.1'].minecraft = version;
    assert.equal((await loadConfig(await project(t, value))).config.targets['fabric-1.21.1'].minecraft, version);
  }
});

test('schema rejects invalid loaders, zero minimum tests and unknown shared fields', async (t) => {
  for (const mutate of [
    (value: any) => { value.targets['fabric-1.21.1'].loader = 'quilt'; },
    (value: any) => { value.suites.unit.minTests = 0; },
    (value: any) => { value.targets['fabric-1.21.1'].requiredSuites.push('unit'); },
    (value: any) => { value.extra = true; },
  ]) {
    const value = config(); mutate(value);
    await assert.rejects(loadConfig(await project(t, value)), ConfigError);
  }
});

test('unsupported suites can remain required so the execution gate reports unsupported', async (t) => {
  const value: any = config(); value.suites.unit = { driver: 'unsupported', requiredCapabilities: ['real-client'] };
  const loaded = await loadConfig(await project(t, value));
  assert.deepEqual(loaded.config.targets['fabric-1.21.1'].requiredSuites, ['unit']);
});

test('paths and identifiers are portable and cannot escape through either path syntax', async (t) => {
  for (const badPath of ['../outside', '..\\outside', 'C:\\outside', 'C:relative', '/outside', '\\\\server\\share', 'build/../../outside', '.', 'mods/NUL.jar', 'trailing./mod.jar']) {
    const value = config(); value.targets['fabric-1.21.1'].artifactManifest = badPath;
    await assert.rejects(loadConfig(await project(t, value)), /safe relative path/);
  }
  for (const id of ['../outside', 'NUL', 'constructor']) {
    const value = config(); value.projectId = id;
    await assert.rejects(loadConfig(await project(t, value)), ConfigError);
  }
  const value = config(); value.targets['fabric-1.21.1'].tasks.build = ['--init-script'];
  await assert.rejects(loadConfig(await project(t, value)), /cannot be command-line options/);
});

test('rejects build roots escaping through an existing symlink even below missing children', async (t) => {
  const root = await project(t);
  const outside = await mkdtemp(path.join(tmpdir(), 'mch outside '));
  t.after(() => rm(outside, { recursive: true, force: true }));
  try { await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('symlink creation unavailable'); return; } throw error; }
  const value = config(); value.builds.main.root = 'escape/missing-child';
  await writeFile(path.join(root, 'harness.config.json'), JSON.stringify(value));
  await assert.rejects(loadConfig(root), /resolved path escapes/);
});

test('permits nested build roots and missing environment dependencies for doctor', async (t) => {
  const root = await project(t);
  await mkdir(path.join(root, 'build roots', '日本語'), { recursive: true });
  const value = config(); value.builds.main.root = 'build roots/日本語';
  await writeFile(path.join(root, 'harness.config.json'), JSON.stringify(value));
  assert.equal((await loadConfig(root)).config.builds.main.root, 'build roots/日本語');
});

test('lock rejects mutable version and incorrect hashes, local Java requires absolute paths', async (t) => {
  const root = await project(t);
  for (const tool of [{ version: 'latest', sha256: 'a'.repeat(64) }, { version: '1.0.0', sha256: 'bad' }]) {
    await writeFile(path.join(root, 'harness.lock.json'), JSON.stringify({ schemaVersion: 1, tools: { pilot: tool } }));
    await assert.rejects(loadConfig(root), ConfigError);
  }
  await rm(path.join(root, 'harness.lock.json'));
  await writeFile(path.join(root, 'harness.local.json'), JSON.stringify({ schemaVersion: 1, java: { jdk21: 'relative/path' } }));
  await assert.rejects(loadConfig(root), /Java path must be absolute/);
});

function manifest() {
  return { schemaVersion: 1, target: 'fabric-1.21.1', minecraft: '1.21.1', loader: 'fabric', artifacts: [{ path: 'build/libs/example.jar', kind: 'distribution', side: 'both' }] };
}

test('artifact schema distinguishes distributions, sources, development jars and placement side', () => {
  const value: any = manifest();
  value.artifacts.push({ path: 'build/libs/example-sources.jar', kind: 'sources', side: 'client' });
  value.classpath = ['C:\\Gradle Cache\\minecraft.jar'];
  assert.equal(validateArtifactManifest(value).artifacts.length, 2);
  assert.equal(validateArtifactManifest(value).classpath[0], value.classpath[0]);
  value.artifacts[0].side = 'invalid';
  assert.throws(() => validateArtifactManifest(value), ConfigError);
});

test('artifact validation prevents escape, duplicate deployment and version mismatch', () => {
  for (const badPath of ['../example.jar', 'C:\\example.jar', '/example.jar']) {
    const value = manifest(); value.artifacts[0].path = badPath;
    assert.throws(() => validateArtifactManifest(value), /safe relative path/);
  }
  const duplicate = manifest(); duplicate.artifacts.push({ ...duplicate.artifacts[0], path: './build/libs/example.jar' });
  assert.throws(() => validateArtifactManifest(duplicate), /duplicate artifact/);
  const old = manifest(); old.minecraft = '1.20';
  assert.throws(() => validateArtifactManifest(old), /lower bound/);
  assert.throws(() => validateArtifactManifest({ ...manifest(), schemaVersion: 2 }), ConfigError);
});
