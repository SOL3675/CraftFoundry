import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectFixtureEvidence } from '../.github/scripts/collect-fixture-evidence.mjs';
import { acquireStorageLease, attachStorageEvidence, cleanupStorage, closeStorageReservation, createStorageEvidenceSeal, createStorageReservation, releaseStorageLease, validateStorageEvidenceSeal } from '../dist/core/storage.js';
import { readReport, saveReport } from '../dist/reporting/report.js';
import type { RunReport } from '../src/reporting/types.ts';

test('CI retains session failure logs without a final report and excludes worlds and caches', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mch-ci-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = path.join(root, '.harness/runs/interrupted-run/sessions/target/suite');
  for (const [name, content] of Object.entries({ 'client/logs/client.log': 'Actual startup failure', 'client/crash-reports/crash.txt': 'Actual crash diagnosis', 'server/world/private.log': 'world data', 'client/mct-cache/private.log': 'cache data' })) {
    const file = path.join(session, name);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content);
  }
  const truncated = path.join(root, '.harness/runs/truncated-run');
  await mkdir(path.join(truncated, 'sessions/target/client'), { recursive: true });
  await writeFile(path.join(truncated, 'report.json'), '{"unfinished":');
  await writeFile(path.join(truncated, 'sessions/target/client/failure.log'), 'Retain crash even when report write was interrupted');
  await collectFixtureEvidence(root);
  const output = path.join(root, '.harness/ci/evidence/runs/interrupted-run/sessions/target/suite');
  assert.equal(await readFile(path.join(output, 'client/logs/client.log'), 'utf8'), 'Actual startup failure');
  assert.equal(await readFile(path.join(output, 'client/crash-reports/crash.txt'), 'utf8'), 'Actual crash diagnosis');
  await assert.rejects(readFile(path.join(output, 'server/world/private.log')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(output, 'client/mct-cache/private.log')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, '.harness/ci/evidence/runs/truncated-run/sessions/target/client/failure.log'), 'utf8'), 'Retain crash even when report write was interrupted');
  assert.equal(await readFile(new URL('../.github/scripts/collect-fixture-evidence.mjs', import.meta.url), 'utf8'), await readFile(new URL('../templates/ci/scripts/collect-fixture-evidence.mjs', import.meta.url), 'utf8'));
});

test('CI copies declared JSON details outside sessions and explicitly fails if a companion disappears', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mch-ci-details-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = path.join(root, '.harness/runs/detail-run'); await mkdir(run, { recursive: true });
  const full = JSON.stringify({ reason: 'Complete detail 日本語🌋 <&> '.repeat(100000) });
  await writeFile(path.join(run, 'detail.json'), full);
  await writeFile(path.join(run, 'report.json'), JSON.stringify({ targets: [{ suites: [{ cases: [{ id: 'case', status: 'failed', detail: { file: 'detail.json', pointer: '/reason' } }] }] }] }));
  await collectFixtureEvidence(root);
  assert.equal(await readFile(path.join(root, '.harness/ci/evidence/runs/detail-run/detail.json'), 'utf8'), full);
  await rm(path.join(run, 'detail.json'));
  await assert.rejects(collectFixtureEvidence(root), { code: 'ENOENT' });
});

async function sealedRun(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'mch-ci-seal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = path.join(root, '.harness/runs/scoped-run'); await mkdir(run, { recursive: true });
  const report: RunReport = { schemaVersion: 1, id: 'scoped-run', command: 'mch test', startedAt: new Date().toISOString(),
    status: 'infrastructure-error', harnessVersion: 'test', platform: { os: process.platform, arch: process.arch, node: process.version }, source: { limitations: [] }, configuration: {}, lock: {}, targets: [], reproduction: { command: 'mch test', limitations: [] } };
  await saveReport(run, report);
  const cache = path.join(root, '.harness/c', randomUUID(), 'mct-cache/client');
  const reservation = await createStorageReservation(root, cache), lease = await acquireStorageLease(root, reservation);
  await mkdir(cache, { recursive: true }); await writeFile(path.join(cache, 'dependency.jar'), 'disposable dependency');
  const files = ['sessions/target/suite/result.binary', 'sessions/target/suite/world/level.dat', 'artifacts/scope.jar'];
  for (const file of files) { await mkdir(path.dirname(path.join(run, file)), { recursive: true }); await writeFile(path.join(run, file), `retained ${file}`); }
  await writeFile(path.join(run, 'sessions/target/suite/world/undeclared.dat'), 'not declared');
  const ref = await createStorageEvidenceSeal(root, run, { scope: { target: 'target', suite: 'suite' }, files });
  await attachStorageEvidence(root, run, [ref]);
  await releaseStorageLease(root, lease, { stopped: true, evidenceRoot: run, seal: ref });
  await closeStorageReservation(root, reservation);
  assert.ok((await cleanupStorage(root, { apply: true, unitIds: [reservation.id] })).deletedBytes > 0);
  assert.equal((await readReport(root, 'scoped-run')).finishedAt, undefined);
  return { root, run, ref, files };
}

test('CI exports exact sealed files after unfinished-Run reclamation and relocated reports still verify', async t => {
  const { root, run, ref, files } = await sealedRun(t);
  await collectFixtureEvidence(root);
  const exported = path.join(root, '.harness/ci/evidence/runs/scoped-run');
  for (const file of [ref.file, ...files]) assert.deepEqual(await readFile(path.join(exported, file)), await readFile(path.join(run, file)));
  await assert.rejects(readFile(path.join(exported, 'sessions/target/suite/world/undeclared.dat')), { code: 'ENOENT' });
  const relocated = await mkdtemp(path.join(tmpdir(), 'mch-ci-relocated-'));
  t.after(() => rm(relocated, { recursive: true, force: true }));
  const relocatedRun = path.join(relocated, '.harness/runs/scoped-run');
  await mkdir(path.dirname(relocatedRun), { recursive: true }); await cp(exported, relocatedRun, { recursive: true });
  assert.deepEqual((await readReport(relocated, 'scoped-run')).storageEvidence, [ref]);
  assert.equal((await validateStorageEvidenceSeal(relocatedRun, ref)).files.length, files.length);
});

test('CI fails closed for changed, missing, escaping or malformed scoped evidence', async t => {
  for (const mode of ['changed', 'missing', 'escaping', 'malformed']) {
    const { root, run, ref, files } = await sealedRun(t);
    if (mode === 'changed') await writeFile(path.join(run, files[0]!), 'changed');
    else if (mode === 'missing') await rm(path.join(run, files[0]!));
    else {
      const report = JSON.parse(await readFile(path.join(run, 'report.json'), 'utf8'));
      report.storageEvidence = mode === 'malformed' ? {} : [{ ...ref, file: '../outside.json' }];
      await writeFile(path.join(run, 'report.json'), JSON.stringify(report));
    }
    await assert.rejects(collectFixtureEvidence(root), mode === 'missing' ? { code: 'ENOENT' } : /storage evidence|SHA-256/i);
  }
});
