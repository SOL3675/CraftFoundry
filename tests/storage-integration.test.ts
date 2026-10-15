import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStorageUnit, finalizeStorageUnit } from '../dist/core/storage.js';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));

async function fixture(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'Foundry storage CLI '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'build/libs'), { recursive: true });
  await writeFile(path.join(root, 'build/libs/fixture.jar'), 'Offline contract artifact');
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, target: 'fabric', minecraft: '1.21.1', loader: 'fabric', artifacts: [{ path: 'build/libs/fixture.jar', kind: 'distribution', side: 'both' }] }));
  await writeFile(path.join(root, 'harness.config.json'), JSON.stringify({ schemaVersion: 1, projectId: 'storage-contract',
    builds: { main: { root: '.', adapter: 'gradle' } },
    targets: { fabric: { minecraft: '1.21.1', loader: 'fabric', build: 'main', tasks: { build: ['assemble'] }, artifactManifest: 'manifest.json', requiredSuites: ['offline'] } },
    suites: { offline: { driver: 'process', runtime: 'offline', results: 'results.json', expectedTests: ['fixture.storage'] } },
    runtimes: { offline: { kind: 'server', capabilities: [], command: { executable: process.execPath, args: ['{projectRoot}/produce.mjs'] } } },
  }));
  await writeFile(path.join(root, 'produce.mjs'), "import {writeFileSync} from 'node:fs'; console.log('retained process log'); writeFileSync('results.json', JSON.stringify({schemaVersion:1,cases:[{id:'fixture.storage',status:'passed'}]}));");
  await writeFile(path.join(root, 'gradlew.bat'), '@echo off\r\nexit /b 0\r\n');
  await writeFile(path.join(root, 'gradlew'), '#!/bin/sh\nexit 0\n');
  await chmod(path.join(root, 'gradlew'), 0o755);
  const local = (storage: unknown) => writeFile(path.join(root, 'harness.local.json'), JSON.stringify({ schemaVersion: 1, storage }));
  const invoke = async (...args: string[]) => {
    let result: any;
    try { result = { ...await execute(process.execPath, [cli, ...args, '--project', root, '--json'], { windowsHide: true, timeout: 30_000 }), code: 0 }; }
    catch (error: any) { result = { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
    assert.equal(typeof result.stdout, 'string', JSON.stringify(result));
    assert.equal(result.stdout.trim().split('\n').length, 1, 'JSON mode emits one machine-readable object');
    return { ...result, output: JSON.parse(result.stdout) };
  };
  return { root, local, invoke };
}

test('storage CLI inventories an empty project without creating storage data', async (t) => {
  const f = await fixture(t);
  const result = await f.invoke('storage');
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.output.schemaVersion, 1);
  assert.equal(result.output.sizeKind, 'logical');
  assert.equal(result.output.totalBytes, 0);
  assert.equal(result.output.reclaimableBytes, 0);
  assert.deepEqual(result.output.entries, []);
  await assert.rejects(readdir(path.join(f.root, '.harness')), /ENOENT/);
});

test('storage preview and explicit apply preserve historical unowned caches, worlds and evidence', async (t) => {
  const f = await fixture(t);
  const historical = {
    '.harness/c/old-client/mct-cache/client/libraries/dependency.jar': 're-downloadable but unowned',
    '.harness/c/old-client/mct-home/saves/world/level.dat': 'irreplaceable world',
    '.harness/runs/old-run/report.json': '{"historical":"report"}',
    '.harness/runs/old-run/screenshots/failure.png': 'failure image',
  };
  for (const [relative, bytes] of Object.entries(historical)) {
    await mkdir(path.dirname(path.join(f.root, relative)), { recursive: true });
    await writeFile(path.join(f.root, relative), bytes);
  }
  const expectedBytes = Object.values(historical).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  const inventory = await f.invoke('storage');
  assert.equal(inventory.code, 0, inventory.stdout);
  assert.equal(inventory.output.totalBytes, expectedBytes);
  assert.equal(inventory.output.retainedBytes, expectedBytes);
  assert.equal(inventory.output.reclaimableBytes, 0);
  for (const relative of Object.keys(historical)) {
    const entry = inventory.output.entries.find((item: any) => item.path === relative);
    assert.equal(entry?.disposition, 'retain', relative);
    assert.equal(entry.reason, 'unmarked-or-retained-data');
  }
  const preview = await f.invoke('storage', '--clean');
  assert.equal(preview.code, 0, preview.stdout);
  assert.equal(preview.output.apply, false);
  assert.equal(preview.output.deletedBytes, 0);
  assert.deepEqual(preview.output.entries, inventory.output.entries);
  await assert.rejects(readdir(path.join(f.root, '.harness/storage')), /ENOENT/);
  const applied = await f.invoke('storage', '--clean', '--apply');
  assert.equal(applied.code, 0, applied.stdout);
  assert.equal(applied.output.apply, true);
  assert.equal(applied.output.deletedBytes, 0);
  assert.deepEqual(applied.output.errors, []);
  const audit = JSON.parse(await readFile(path.join(f.root, applied.output.auditPath), 'utf8'));
  assert.equal(audit.complete, true);
  assert.equal(audit.deletedBytes, 0);
  for (const [relative, bytes] of Object.entries(historical)) assert.equal(await readFile(path.join(f.root, relative), 'utf8'), bytes);
});

test('storage CLI rejects unsafe or ambiguous flag combinations as structured errors', async (t) => {
  const f = await fixture(t);
  const id = '54b0bc72-bcf5-4cb9-8a92-c8b8a150f0df';
  for (const args of [
    ['storage', '--apply'], ['storage', '--unit', id], ['storage', '--clean', '--unit', '../outside'],
    ['storage', '--clean', '--unit'], ['storage', '--clean', '--clean'], ['storage', '--target', 'fabric'],
    ['storage', '--unknown'], ['targets', '--clean'], ['test', '--apply'],
  ]) {
    const result = await f.invoke(...args);
    assert.equal(result.code, 2, args.join(' '));
    assert.equal(result.output.status, 'infrastructure-error');
    assert.equal(typeof result.output.error, 'string');
  }
  await assert.rejects(readdir(path.join(f.root, '.harness')), /ENOENT/);
});

test('local storage policy rejects unknown fields, values and non-boolean opt-ins', async (t) => {
  const f = await fixture(t);
  for (const storage of [null, true, { managedCaches: 'true' }, { sharedAssets: 1 }, { cleanup: true }, { cleanup: 'always' }, { cleanup: 'after-run' }, { managedCaches: false, cleanup: 'after-run' }, { removeWorlds: true }]) {
    await f.local(storage);
    const result = await f.invoke('targets');
    assert.equal(result.code, 2, JSON.stringify(storage));
    assert.equal(result.output.code, 'CONFIG_INVALID');
    assert.ok(result.output.diagnostics.some((message: string) => message.includes('storage')));
  }
});

test('opt-in storage policies preserve process-suite reports, results and logs', async (t) => {
  const f = await fixture(t);
  for (const storage of [{}, { managedCaches: true, sharedAssets: true, cleanup: 'retain' }, { managedCaches: true, sharedAssets: true, cleanup: 'after-run' }]) {
    await f.local(storage);
    const tested = await f.invoke('test', '--target', 'fabric');
    assert.equal(tested.code, 0, tested.stdout);
    assert.equal(tested.output.status, 'passed');
    const suite = tested.output.targets[0].suites[0];
    assert.equal(suite.detected, 1);
    const runRoot = path.join(f.root, '.harness/runs', tested.output.id);
    assert.deepEqual((await f.invoke('report', '--run', tested.output.id)).output, tested.output);
    assert.match(await readFile(path.join(runRoot, 'junit.xml'), 'utf8'), /fixture.storage/);
    assert.equal(JSON.parse(await readFile(path.join(runRoot, 'sessions/fabric/offline/results.json'), 'utf8')).cases[0].status, 'passed');
    assert.ok((await Promise.all(suite.logs.map((relative: string) => readFile(path.join(runRoot, relative), 'utf8')))).some(bytes => bytes.includes('retained process log')));
    const preview = await f.invoke('storage', '--clean');
    assert.equal(preview.code, 0, preview.stdout);
    assert.equal(preview.output.deletedBytes, 0);
    assert.equal(preview.output.reclaimableBytes, 0, 'ordinary process sessions cannot be adopted as disposable client caches');
  }
});

test('storage CLI reclaims only a selected finalized dependency unit and preserves its Run', async (t) => {
  const f = await fixture(t);
  const tested = await f.invoke('test', '--target', 'fabric');
  assert.equal(tested.code, 0, tested.stdout);
  const runRoot = path.join(f.root, '.harness/runs', tested.output.id);
  const cache = path.join(f.root, '.harness/c', randomUUID(), 'mct-cache/client');
  const unit = await createStorageUnit(f.root, cache);
  await mkdir(path.join(cache, 'libraries'), { recursive: true });
  const dependency = Buffer.alloc(4096, 7);
  await writeFile(path.join(cache, 'libraries/fixture.jar'), dependency);
  await finalizeStorageUnit(f.root, unit, { stopped: true, evidenceRoot: runRoot });
  const excluded = await f.invoke('storage', '--clean', '--unit', randomUUID(), '--apply');
  assert.equal(excluded.code, 0, excluded.stdout);
  assert.equal(excluded.output.deletedBytes, 0);
  assert.deepEqual(await readFile(path.join(cache, 'libraries/fixture.jar')), dependency);
  const preview = await f.invoke('storage', '--clean', '--unit', unit.id);
  assert.equal(preview.code, 0, preview.stdout);
  assert.equal(preview.output.reclaimableBytes, dependency.length);
  assert.equal(preview.output.deletedBytes, 0);
  assert.ok(preview.output.entries.some((entry: any) => entry.unitId === unit.id && entry.disposition === 'reclaim'));
  assert.deepEqual(await readFile(path.join(cache, 'libraries/fixture.jar')), dependency);
  const applied = await f.invoke('storage', '--clean', '--unit', unit.id, '--apply');
  assert.equal(applied.code, 0, applied.stdout);
  assert.equal(applied.output.deletedBytes, dependency.length);
  assert.deepEqual(applied.output.errors, []);
  await assert.rejects(readFile(path.join(cache, 'libraries/fixture.jar')), /ENOENT/);
  assert.deepEqual((await f.invoke('report', '--run', tested.output.id)).output, tested.output);
  assert.equal(JSON.parse(await readFile(path.join(runRoot, 'sessions/fabric/offline/results.json'), 'utf8')).cases[0].id, 'fixture.storage');
  const repeated = await f.invoke('storage', '--clean', '--unit', unit.id, '--apply');
  assert.equal(repeated.code, 0, repeated.stdout);
  assert.equal(repeated.output.deletedBytes, 0);
  assert.deepEqual(repeated.output.errors, []);
});
