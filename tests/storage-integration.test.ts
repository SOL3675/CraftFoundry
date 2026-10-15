import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStorageUnit, finalizeStorageUnit, createStorageReservation, acquireStorageLease, createStorageEvidenceSeal, attachStorageEvidence, releaseStorageLease, closeStorageReservation } from '../dist/core/storage.js';
import { saveReport } from '../dist/reporting/report.js';

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
  for (const storage of [null, true, { managedCaches: 'true' }, { sharedAssets: 1 }, { cleanup: true }, { cleanup: 'always' }, { cleanup: 'after-run' }, { managedCaches: false, cleanup: 'after-run' }, { cleanup: 'after-suite' }, { managedCaches: false, cleanup: 'after-suite' }, { removeWorlds: true }]) {
    await f.local(storage);
    const result = await f.invoke('targets');
    assert.equal(result.code, 2, JSON.stringify(storage));
    assert.equal(result.output.code, 'CONFIG_INVALID');
    assert.ok(result.output.diagnostics.some((message: string) => message.includes('storage')));
  }
});

test('opt-in storage policies preserve process-suite reports, results and logs', async (t) => {
  const f = await fixture(t);
  for (const storage of [{}, { managedCaches: true, sharedAssets: true, cleanup: 'retain' }, { managedCaches: true, sharedAssets: true, cleanup: 'after-run' }, { managedCaches: true, cleanup: 'after-suite' }]) {
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

test('mid-Run cleanup requires released leases, a closed reservation and durable partial evidence references', async (t) => {
  const f = await fixture(t);
  const tested = await f.invoke('test', '--target', 'fabric');
  assert.equal(tested.code, 0, tested.stdout);
  const report = structuredClone(tested.output), runRoot = path.join(f.root, '.harness/runs', report.id);
  delete report.finishedAt; report.status = 'infrastructure-error';
  await saveReport(runRoot, report);
  const cache = path.join(f.root, '.harness/c', randomUUID(), 'mct-cache/client');
  const reservation = await createStorageReservation(f.root, cache);
  const first = await acquireStorageLease(f.root, reservation);
  await mkdir(path.join(cache, 'libraries'), { recursive: true });
  const dependency = Buffer.alloc(8192, 3);
  await writeFile(path.join(cache, 'libraries/fixture.jar'), dependency);
  const suite = report.targets[0].suites[0];
  const files = ['sessions/fabric/offline/results.json', ...suite.logs];
  const seal = await createStorageEvidenceSeal(f.root, runRoot, { scope: { target: 'fabric', suite: 'offline', phase: 'first' }, files });
  await assert.rejects(releaseStorageLease(f.root, first, { stopped: false, evidenceRoot: runRoot, seal }));
  await assert.rejects(closeStorageReservation(f.root, reservation), 'a live lease prevents reservation closure');
  await attachStorageEvidence(f.root, runRoot, [seal]);
  await releaseStorageLease(f.root, first, { stopped: true, evidenceRoot: runRoot, seal });
  // The parent can checkpoint an older in-memory report without dropping the attached seal.
  await saveReport(runRoot, report);
  report.storageEvidence = [seal];
  const gap = await f.invoke('storage', '--clean', '--unit', reservation.id, '--apply');
  assert.equal(gap.code, 0, gap.stdout); assert.equal(gap.output.deletedBytes, 0);
  assert.deepEqual(await readFile(path.join(cache, 'libraries/fixture.jar')), dependency);
  const second = await acquireStorageLease(f.root, reservation);
  await assert.rejects(closeStorageReservation(f.root, reservation));
  const secondSeal = await createStorageEvidenceSeal(f.root, runRoot, { scope: { target: 'fabric', suite: 'offline', phase: 'second' }, files });
  await attachStorageEvidence(f.root, runRoot, [secondSeal]);
  await releaseStorageLease(f.root, second, { stopped: true, evidenceRoot: runRoot, seal: secondSeal });
  report.storageEvidence.push(secondSeal); await saveReport(runRoot, report);
  await closeStorageReservation(f.root, reservation);
  // A different suite may continue writing while this completed scope is reclaimed.
  await mkdir(path.join(runRoot, 'sessions/fabric/later'), { recursive: true });
  await writeFile(path.join(runRoot, 'sessions/fabric/later/working.log'), 'another suite is still active');
  const preview = await f.invoke('storage', '--clean', '--unit', reservation.id);
  assert.equal(preview.code, 0, preview.stdout); assert.equal(preview.output.reclaimableBytes, dependency.length);
  const applied = await f.invoke('storage', '--clean', '--unit', reservation.id, '--apply');
  assert.equal(applied.code, 0, applied.stdout); assert.equal(applied.output.deletedBytes, dependency.length);
  assert.deepEqual(applied.output.errors, []);
  const unfinished = await f.invoke('report', '--run', report.id);
  assert.equal(unfinished.code, 0, unfinished.stdout); assert.equal(unfinished.output.finishedAt, undefined);
  assert.deepEqual(unfinished.output.storageEvidence, report.storageEvidence);
  for (const relative of files) await readFile(path.join(runRoot, relative));
  assert.equal(await readFile(path.join(runRoot, 'sessions/fabric/later/working.log'), 'utf8'), 'another suite is still active');
  report.finishedAt = new Date().toISOString(); report.status = tested.output.status; await saveReport(runRoot, report);
  assert.deepEqual((await f.invoke('report', '--run', report.id)).output, report);
  assert.equal((await f.invoke('storage', '--clean', '--unit', reservation.id, '--apply')).output.deletedBytes, 0);
  const sealFile = path.join(runRoot, seal.file), originalSeal = await readFile(sealFile);
  await writeFile(sealFile, '{"tampered":true}');
  assert.equal((await f.invoke('report', '--run', report.id)).code, 2, 'inspection must verify retained scope seals after cleanup');
  await writeFile(sealFile, originalSeal);
  assert.deepEqual((await f.invoke('report', '--run', report.id)).output, report);
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

test('a process driver reclaims its completed phase before exit and the parent preserves its attached evidence', async (t) => {
  const f = await fixture(t);
  await f.local({ managedCaches: true, cleanup: 'after-suite' });
  const storageModule = new URL('../dist/core/storage.js', import.meta.url).href;
  await writeFile(path.join(f.root, 'produce.mjs'), `
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createStorageReservation,acquireStorageLease,createStorageEvidenceSeal,attachStorageEvidence,releaseStorageLease,closeStorageReservation,cleanupStorage} from ${JSON.stringify(storageModule)};
const root=process.env.MCH_PROJECT_ROOT,runRoot=process.env.MCH_RUN_ROOT,session=process.env.MCH_SESSION_ROOT;
assert.ok(root && runRoot && session,'the process driver must provide the current Run root');
const initial=JSON.parse(await readFile(join(runRoot,'report.json'),'utf8'));
assert.equal(initial.finishedAt,undefined);
const cache=join(root,'.harness/c',randomUUID(),'mct-cache/client'),reservation=await createStorageReservation(root,cache);
const lease=await acquireStorageLease(root,reservation);
await mkdir(join(cache,'libraries'),{recursive:true}); await writeFile(join(cache,'libraries/dependency.jar'),Buffer.alloc(8192,5));
await mkdir(join(session,'world'),{recursive:true}); await writeFile(join(session,'world/level.dat'),'retained phase world');
const phase={unitId:reservation.id,observedRunFinished:false,dependencyBytes:8192};
await writeFile(join(session,'phase.json'),JSON.stringify(phase));
const runRelative=file=>relative(runRoot,join(session,file)).replaceAll('\\\\','/');
const seal=await createStorageEvidenceSeal(root,runRoot,{scope:{target:process.env.MCH_TARGET,suite:'offline',phase:'completed'},files:[runRelative('phase.json'),runRelative('world/level.dat')]});
await attachStorageEvidence(root,runRoot,[seal]);
await releaseStorageLease(root,lease,{stopped:true,evidenceRoot:runRoot,seal});
await closeStorageReservation(root,reservation);
const cleanup=await cleanupStorage(root,{apply:true,unitIds:[reservation.id]});
assert.equal(cleanup.deletedBytes,8192); assert.deepEqual(cleanup.errors,[]);
assert.equal(JSON.parse(await readFile(join(runRoot,'report.json'),'utf8')).finishedAt,undefined);
assert.equal(await readFile(join(session,'world/level.dat'),'utf8'),'retained phase world');
await writeFile(join(session,'results.json.evidence.json'),JSON.stringify({cleanup,cache,observedRunFinished:false}));
await writeFile(join(session,'results.json'),JSON.stringify({schemaVersion:1,cases:[{id:'fixture.storage',status:'passed',detail:{file:'results.json.evidence.json',pointer:'/cleanup'}}]}));
console.log('phase reclaimed while parent Run remains unfinished');
`);
  const tested = await f.invoke('test', '--target', 'fabric');
  assert.equal(tested.code, 0, tested.stdout);
  assert.equal(tested.output.status, 'passed'); assert.ok(tested.output.finishedAt);
  assert.equal(tested.output.storageEvidence.length, 1, 'the parent checkpoint must preserve a child-attached reference');
  const runRoot = path.join(f.root, '.harness/runs', tested.output.id);
  const suite = tested.output.targets[0].suites[0], detail = suite.cases[0].detail.file;
  const proof = JSON.parse(await readFile(path.join(runRoot, detail), 'utf8'));
  assert.equal(proof.observedRunFinished, false); assert.equal(proof.cleanup.deletedBytes, 8192);
  assert.deepEqual(proof.cleanup.errors, []);
  assert.equal(JSON.parse(await readFile(path.join(f.root, proof.cleanup.auditPath), 'utf8')).complete, true);
  await assert.rejects(readFile(path.join(proof.cache, 'libraries/dependency.jar')), /ENOENT/);
  assert.equal(await readFile(path.join(runRoot, 'sessions/fabric/offline/world/level.dat'), 'utf8'), 'retained phase world');
  const seal = tested.output.storageEvidence[0], manifest = JSON.parse(await readFile(path.join(runRoot, seal.file), 'utf8'));
  assert.deepEqual(manifest.scope, { target: 'fabric', suite: 'offline', phase: 'completed' });
  assert.equal(manifest.files.length, 2);
  assert.equal(JSON.parse(await readFile(path.join(runRoot, 'sessions/fabric/offline/phase.json'), 'utf8')).observedRunFinished, false);
  assert.ok(suite.evidence.includes(detail));
  assert.deepEqual((await f.invoke('report', '--run', tested.output.id)).output, tested.output);
});
