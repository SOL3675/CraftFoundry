import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, link, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createStorageEvidenceSeal, validateStorageEvidenceSeal } from '../dist/reporting/storage-evidence.js';
import { attachStorageEvidence, readReport, saveReport } from '../dist/reporting/report.js';
import type { RunReport } from '../src/reporting/types.ts';

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mch scoped evidence ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = join(root, '.harness', 'runs', 'ongoing-run'); await mkdir(join(run, 'completed'), { recursive: true });
  await writeFile(join(run, 'completed', 'suite.json'), '{"status":"failed"}\n');
  await writeFile(join(run, 'completed', 'driver.log'), 'full diagnostic evidence\n');
  const report: RunReport = { schemaVersion: 1, id: 'ongoing-run', command: 'mch test', startedAt: new Date().toISOString(), status: 'infrastructure-error', harnessVersion: 'test', platform: { os: process.platform, arch: process.arch, node: process.version }, source: { limitations: [] }, configuration: {}, lock: {}, targets: [], reproduction: { command: 'mch test', limitations: [] } };
  await saveReport(run, report);
  const seal = () => createStorageEvidenceSeal(root, run, { scope: { target: 'fabric-1.21.1', suite: 'capture', phase: 'first' }, files: ['completed/suite.json', 'completed/driver.log'] });
  return { root, run, report, seal };
}

test('partial evidence seals remain valid while unrelated Run evidence and unfinished reports evolve', async t => {
  const { root, run, report, seal } = await fixture(t); const reference = await seal();
  report.storageEvidence = [reference]; await saveReport(run, report);
  assert.equal((await readReport(root, report.id)).finishedAt, undefined);
  await mkdir(join(run, 'running')); await writeFile(join(run, 'running', 'driver.log'), 'running');
  await writeFile(join(run, 'running', 'driver.log'), 'still running');
  report.error = 'another phase remains active'; await saveReport(run, report);
  const manifest = await validateStorageEvidenceSeal(run, reference);
  assert.equal(manifest.runId, report.id); assert.equal(manifest.scope.phase, 'first'); assert.equal(manifest.files.length, 2);
  assert.deepEqual((await readReport(root, report.id)).storageEvidence, [reference]);
});

test('tampered or missing scoped evidence blocks seal validation and unfinished report saves/reads', async t => {
  for (const mode of ['tamper', 'missing']) {
    const { root, run, report, seal } = await fixture(t); const reference = await seal();
    report.storageEvidence = [reference]; await saveReport(run, report);
    const originalReport = await readFile(join(run, 'report.json'));
    if (mode === 'tamper') await writeFile(join(run, 'completed', 'driver.log'), 'changed diagnostic evidence');
    else await rm(join(run, 'completed', 'driver.log'));
    await assert.rejects(validateStorageEvidenceSeal(run, reference));
    await assert.rejects(saveReport(run, report));
    assert.deepEqual(await readFile(join(run, 'report.json')), originalReport);
    await assert.rejects(readReport(root, report.id));
  }
});

test('seal digest, scope, membership and Run identity cannot be substituted', async t => {
  const { root, run, seal } = await fixture(t); const reference = await seal();
  await assert.rejects(validateStorageEvidenceSeal(run, { ...reference, sha256: '0'.repeat(64) }), /SHA-256/u);
  const filename = join(run, reference.file); const manifest = JSON.parse(await readFile(filename, 'utf8'));
  manifest.scope.target = '../outside';
  let content = `${JSON.stringify(manifest)}\n`; await writeFile(filename, content);
  await assert.rejects(validateStorageEvidenceSeal(run, { ...reference, sha256: createHash('sha256').update(content).digest('hex') }), /Invalid storage evidence manifest/u);
  manifest.scope.target = 'fabric-1.21.1'; manifest.runId = 'another-run';
  content = `${JSON.stringify(manifest)}\n`; await writeFile(filename, content);
  await assert.rejects(validateStorageEvidenceSeal(run, { ...reference, sha256: createHash('sha256').update(content).digest('hex') }), /identity/u);
  await assert.rejects(createStorageEvidenceSeal(root, run, { scope: { target: 'target', suite: 'suite' }, files: ['completed/suite.json', 'completed/suite.json'] }), /Duplicate/u);
});

test('mutable reports, temporary files, links, hardlinks, empty lists and external paths are rejected', async t => {
  const { root, run } = await fixture(t);
  const create = (files: string[]) => createStorageEvidenceSeal(root, run, { scope: { target: 'target', suite: 'suite' }, files });
  for (const file of ['report.json', 'junit.xml', '../outside.json', 'completed/../suite.json', 'completed/file.tmp', 'unsealed/suite.json', 'storage-seals/other.json', 'C:/external.json', 'completed\\suite.json']) await assert.rejects(create([file]));
  await assert.rejects(create([]), /at least one/u);
  const external = join(root, 'external'); await mkdir(external); await writeFile(join(external, 'outside.json'), '{}');
  await symlink(external, join(run, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(create(['linked/outside.json']), /links/u);
  await link(join(run, 'completed', 'suite.json'), join(run, 'hardlink.json'));
  await assert.rejects(create(['hardlink.json']), /hardlinks/u);
});

test('cross-process evidence attachment survives a stale parent save and updates its returned report', async t => {
  const { root, run, report, seal } = await fixture(t); const reference = await seal();
  const module = new URL('../dist/reporting/report.js', import.meta.url).href;
  const script = `import { attachStorageEvidence } from ${JSON.stringify(module)}; await attachStorageEvidence(${JSON.stringify(root)}, ${JSON.stringify(run)}, ${JSON.stringify([reference])});`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true, timeout: 30_000 });
  assert.equal(report.storageEvidence, undefined);
  report.error = 'parent made progress'; await saveReport(run, report);
  assert.deepEqual(report.storageEvidence, [reference]);
  assert.deepEqual((await readReport(root, report.id)).storageEvidence, [reference]);
  await writeFile(join(run, 'completed', 'driver.log'), 'tampered');
  await assert.rejects(saveReport(run, { ...report, storageEvidence: undefined }));
});

test('parallel report writers merge registrations and failed attachments do not replace reports', async t => {
  const { root, run, report, seal } = await fixture(t); const first = await seal(); const second = await seal();
  await Promise.all([attachStorageEvidence(root, run, [first]), attachStorageEvidence(root, run, [second]), saveReport(run, report)]);
  const saved = await readReport(root, report.id);
  assert.deepEqual(new Set(saved.storageEvidence!.map(item => item.id)), new Set([first.id, second.id]));
  const original = await readFile(join(run, 'report.json'));
  await assert.rejects(attachStorageEvidence(root, run, [{ ...first, sha256: '0'.repeat(64) }]), /Conflicting/u);
  assert.deepEqual(await readFile(join(run, 'report.json')), original);
});

test('legacy reports remain readable and report/Run identity mismatches cannot attach seals', async t => {
  const { root, run, report, seal } = await fixture(t);
  assert.equal((await readReport(root, report.id)).storageEvidence, undefined);
  const reference = await seal();
  await assert.rejects(saveReport(run, { ...report, id: 'wrong-run', storageEvidence: [reference] }), /identity/u);
  await assert.rejects(attachStorageEvidence(join(root, 'external'), run, [reference]));
});

test('a partial JUnit save failure stays an error and leaves evidence references available to retry', async t => {
  const { root, run, report, seal } = await fixture(t); const reference = await seal();
  await rm(join(run, 'junit.xml')); await mkdir(join(run, 'junit.xml'));
  await assert.rejects(attachStorageEvidence(root, run, [reference]));
  assert.ok((await readdir(run)).every(name => !name.endsWith('.tmp') && name !== 'report.write.lock'));
  const persisted = JSON.parse(await readFile(join(run, 'report.json'), 'utf8'));
  assert.deepEqual(persisted.storageEvidence, [reference]);
  await rm(join(run, 'junit.xml'), { recursive: true });
  await saveReport(run, report);
  assert.deepEqual(report.storageEvidence, [reference]);
  assert.deepEqual((await readReport(root, report.id)).storageEvidence, [reference]);
});
