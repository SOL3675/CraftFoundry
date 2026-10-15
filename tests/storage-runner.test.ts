import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { completeSuiteStorage, executeRun } from '../dist/core/runner.js';
import { acquireStorageLease, createStorageReservation, inventoryStorage } from '../dist/core/storage.js';
import { readReport, saveReport } from '../dist/reporting/report.js';
import type { LoadedConfig } from '../src/core/types.ts';
import type { RunReport, SuiteReport, TargetReport } from '../src/reporting/types.ts';

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'Foundry suite boundary ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = path.join(root, '.harness/runs/ongoing'); await mkdir(run, { recursive: true });
  const loaded: LoadedConfig = { root, config: { schemaVersion: 1, projectId: 'suite-boundary', builds: {}, targets: {}, suites: {}, runtimes: {} }, local: { schemaVersion: 1, storage: { managedCaches: true, cleanup: 'after-suite' } }, lock: { schemaVersion: 1, tools: {} } };
  const suite: SuiteReport = { id: 'first', required: true, status: 'failed', detected: 1, cases: [{ id: 'fixture.failure', status: 'failed', message: 'Retain original failure' }], logs: ['sessions/first/client.log'] };
  const target: TargetReport = { id: 'target', minecraft: '1.21.1', loader: 'fabric', status: 'infrastructure-error', artifacts: [], suites: [suite] };
  const report: RunReport = { schemaVersion: 1, id: 'ongoing', command: 'mch test --all', startedAt: new Date().toISOString(), status: 'infrastructure-error', harnessVersion: 'test', platform: { os: process.platform, arch: process.arch, node: process.version }, source: { limitations: [] }, configuration: loaded.config, lock: loaded.lock, targets: [target], reproduction: { command: 'mch test --all', limitations: [] } };
  const cache = path.join(root, '.harness/c', randomUUID(), 'mct-cache/client');
  const reservation = await createStorageReservation(root, cache); const lease = await acquireStorageLease(root, reservation);
  await mkdir(path.join(cache, 'runtime/1.21.1/libraries'), { recursive: true }); await writeFile(path.join(cache, 'runtime/1.21.1/libraries/disposable.jar'), Buffer.alloc(8192, 7));
  await mkdir(path.join(run, 'sessions/first/world'), { recursive: true });
  await writeFile(path.join(run, 'sessions/first/world/level.dat'), 'retained world');
  await writeFile(path.join(run, 'sessions/first/client.log'), 'retained closed client log');
  await saveReport(run, report);
  return { root, run, loaded, report, target, suite, cache, reservation, lease };
}

test('built-in suite boundary reclaims stopped dependencies before the next suite and keeps failed evidence verifiable', async t => {
  const f = await fixture(t);
  const versionMetadata = path.join(f.cache, 'runtime/1.21.1/versions/fixture/fixture.json');
  await mkdir(path.dirname(versionMetadata), { recursive: true });
  await writeFile(versionMetadata, JSON.stringify({ id: 'fixture', libraries: [{ name: 'fixture:dependency:1', downloads: { artifact: { sha1: 'a'.repeat(40) } } }] }));
  const log = path.join(f.run, 'sessions/first/client.log');
  const before = createHash('sha256').update(await readFile(log)).digest('hex');
  await completeSuiteStorage(f.loaded, f.run, f.report, f.target, f.suite, [{ reservation: f.reservation, lease: f.lease, cacheDir: path.dirname(f.cache) }]);
  assert.equal(f.report.finishedAt, undefined);
  await assert.rejects(readFile(path.join(f.cache, 'runtime/1.21.1/libraries/disposable.jar')), { code: 'ENOENT' });
  assert.equal(f.report.storageEvidence?.length, 1);
  const seal = JSON.parse(await readFile(path.join(f.run, f.report.storageEvidence![0]!.file), 'utf8'));
  const retainedVersion = seal.files.find((file: { path: string }) => file.path.endsWith('versions/fixture/fixture.json'));
  assert.ok(retainedVersion, 'actual dependency metadata must survive cache removal');
  assert.equal(JSON.parse(await readFile(path.join(f.run, retainedVersion.path), 'utf8')).id, 'fixture');
  const retainedSnapshot = seal.files.find((file: { path: string }) => file.path.startsWith('storage-evidence/'));
  const snapshot = JSON.parse(await readFile(path.join(f.run, retainedSnapshot.path), 'utf8'));
  assert.equal(snapshot.run.harnessVersion, f.report.harnessVersion);
  assert.deepEqual(snapshot.run.platform, f.report.platform);
  assert.equal((await readReport(f.root, f.report.id)).targets[0]?.suites[0]?.status, 'failed');
  assert.equal(await readFile(path.join(f.run, 'sessions/first/world/level.dat'), 'utf8'), 'retained world');
  await mkdir(path.join(f.run, 'sessions/second')); await writeFile(path.join(f.run, 'sessions/second/client.log'), 'Later suite continues the Run');
  f.target.suites.push({ id: 'second', required: true, status: 'passed', detected: 1, cases: [{ id: 'fixture.second', status: 'passed' }] });
  f.report.finishedAt = new Date().toISOString(); f.report.status = 'failed'; f.target.status = 'failed';
  await saveReport(f.run, f.report);
  assert.deepEqual(await readReport(f.root, f.report.id), f.report);
  assert.equal(createHash('sha256').update(await readFile(log)).digest('hex'), before);
});

test('colliding execution selections are rejected before creating a Run or overwriting sealed paths', async t => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.run, 'report.json'));
  await assert.rejects(executeRun(f.loaded, { command: 'test', targets: ['same', 'same'] }), /colliding target/);
  await assert.rejects(executeRun(f.loaded, { command: 'test', targets: [], suites: ['same', 'same'] }), /colliding suite/);
  if (process.platform === 'win32') {
    await assert.rejects(executeRun(f.loaded, { command: 'test', targets: ['Case', 'case'] }), /colliding target/);
    await assert.rejects(executeRun(f.loaded, { command: 'test', targets: [], suites: ['Case', 'case'] }), /colliding suite/);
  }
  assert.deepEqual(await readdir(path.join(f.root, '.harness/runs')), ['ongoing']);
  assert.deepEqual(await readFile(path.join(f.run, 'report.json')), before);
});

test('a missing suite evidence file prevents lease release and mid-Run cleanup', async t => {
  const f = await fixture(t);
  f.suite.evidence = ['sessions/first/missing.png'];
  await assert.rejects(completeSuiteStorage(f.loaded, f.run, f.report, f.target, f.suite, [{ reservation: f.reservation, lease: f.lease }]), { code: 'ENOENT' });
  assert.equal((await inventoryStorage(f.root)).reclaimableBytes, 0);
  assert.equal((await readFile(path.join(f.cache, 'runtime/1.21.1/libraries/disposable.jar'))).length, 8192);
  assert.equal(f.report.storageEvidence, undefined);
});
