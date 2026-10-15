import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanupStorage, createStorageUnit, finalizeStorageUnit, inventoryStorage } from '../dist/core/storage.js';
import { saveReport } from '../dist/reporting/report.js';
import type { RunReport } from '../src/reporting/types.ts';

async function fixture(t: any) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mch storage ')));
  t.after(async () => { assert.equal(await realpath(root), root); await rm(root, { recursive: true, force: true }); });
  const cache = path.join(root, '.harness', 'c', randomUUID(), 'mct-cache', 'client');
  const run = path.join(root, '.harness', 'runs', 'run-1');
  await mkdir(run, { recursive: true });
  const report: RunReport = { schemaVersion: 1, id: 'run-1', command: 'mch test', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    status: 'failed', harnessVersion: 'test', platform: { os: process.platform, arch: process.arch, node: process.version }, source: { limitations: [] }, configuration: {}, lock: {}, targets: [], reproduction: { command: 'mch test', limitations: [] } };
  await saveReport(run, report);
  return { root, cache, run, report };
}
async function populated(t: any) {
  const data = await fixture(t);
  const handle = await createStorageUnit(data.root, data.cache);
  await mkdir(path.join(data.cache, 'runtime', '1.21.1', 'libraries'), { recursive: true });
  const dependency = path.join(data.cache, 'runtime', '1.21.1', 'libraries', 'dependency.jar');
  await writeFile(dependency, Buffer.alloc(4096, 7));
  const retained = path.join(data.run, 'sessions', 'client', 'world', 'level.dat');
  await mkdir(path.dirname(retained), { recursive: true }); await writeFile(retained, 'world evidence');
  return { ...data, handle, dependency, retained };
}
async function seal(data: Awaited<ReturnType<typeof populated>>) {
  await finalizeStorageUnit(data.root, data.handle, { stopped: true, evidenceRoot: data.run });
}

test('storage dry-run is read-only and apply deletes only sealed dependency files, retaining failed-run evidence and siblings', async t => {
  const data = await populated(t);
  const sibling = path.join(path.dirname(data.cache), 'mod', 'helper.jar');
  await mkdir(path.dirname(sibling)); await writeFile(sibling, 'helper');
  await seal(data);
  const preview = await cleanupStorage(data.root);
  assert.equal(preview.apply, false); assert.equal(preview.deletedBytes, 0); assert.equal(preview.reclaimableBytes, 4096);
  assert.equal(preview.sizeKind, 'logical');
  await assert.rejects(lstat(path.join(data.root, '.harness', 'storage', 'audits')), { code: 'ENOENT' });
  const applied = await cleanupStorage(data.root, { apply: true });
  assert.deepEqual(applied.errors, []); assert.equal(applied.deletedBytes, 4096);
  assert.ok(applied.entries.some(item => item.disposition === 'deleted' && item.path.endsWith('dependency.jar')));
  assert.ok(applied.entries.some(item => item.disposition === 'retain' && item.path.endsWith('level.dat')));
  assert.equal(await readFile(data.retained, 'utf8'), 'world evidence'); assert.equal(await readFile(sibling, 'utf8'), 'helper');
  await assert.rejects(lstat(data.cache), { code: 'ENOENT' });
  const audit = JSON.parse(await readFile(path.join(data.root, applied.auditPath!), 'utf8'));
  assert.equal(audit.complete, true); assert.equal(audit.deletedBytes, 4096);
  assert.equal((await cleanupStorage(data.root, { apply: true })).deletedBytes, 0);
});

test('active units, unfinished reports, wrong ownership and stopped=false cannot become reclaimable', async t => {
  const data = await populated(t);
  assert.equal((await inventoryStorage(data.root)).reclaimableBytes, 0);
  assert.ok((await inventoryStorage(data.root)).entries.some(item => item.reason === 'active-or-unconfirmed-owner'));
  await assert.rejects(finalizeStorageUnit(data.root, data.handle, { stopped: false, evidenceRoot: data.run }), /shutdown/);
  await assert.rejects(finalizeStorageUnit(data.root, { ...data.handle, ownerToken: randomUUID() }, { stopped: true, evidenceRoot: data.run }), /ownership/);
  delete data.report.finishedAt; await saveReport(data.run, data.report);
  await assert.rejects(seal(data), /unfinished/);
  assert.equal((await cleanupStorage(data.root, { apply: true })).deletedBytes, 0);
});

test('existing caches and unknown .harness data remain unowned and cannot be adopted', async t => {
  const data = await fixture(t);
  await mkdir(data.cache, { recursive: true }); await writeFile(path.join(data.cache, 'old.jar'), 'legacy');
  await assert.rejects(createStorageUnit(data.root, data.cache), /Existing storage/);
  const preview = await cleanupStorage(data.root);
  assert.equal(preview.reclaimableBytes, 0);
  assert.ok(preview.entries.some(item => item.path.endsWith('old.jar') && item.reason === 'unmarked-or-retained-data'));
});

test('registration rejects outside paths and concurrent adoption of the same fresh directory', async t => {
  const data = await fixture(t);
  await assert.rejects(createStorageUnit(data.root, path.join(path.dirname(data.root), 'external')), /escapes/);
  await assert.rejects(createStorageUnit(data.root, path.join(data.root, '.harness', 'runs', 'run-1', 'client')), /isolated/);
  const results = await Promise.allSettled([createStorageUnit(data.root, data.cache), createStorageUnit(data.root, data.cache)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
});

test('cache symlinks and mutable game state prevent sealing and are never deleted', async t => {
  for (const mode of ['link', 'world']) {
    const data = await populated(t);
    if (mode === 'link') await symlink(data.run, path.join(data.cache, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    else { await mkdir(path.join(data.cache, 'saves')); await writeFile(path.join(data.cache, 'saves', 'level.dat'), 'precious'); }
    await assert.rejects(seal(data), /links or mutable/);
    assert.equal((await cleanupStorage(data.root, { apply: true })).deletedBytes, 0);
    assert.equal((await lstat(data.dependency)).size, 4096);
  }
});

test('evidence tampering or a new cache file after shutdown invalidates the cleanup preview', async t => {
  for (const mode of ['evidence', 'cache']) {
    const data = await populated(t); await seal(data);
    if (mode === 'evidence') await writeFile(data.retained, 'tampered evidence');
    else await writeFile(path.join(data.cache, 'new.jar'), 'unexpected');
    const result = await cleanupStorage(data.root, { apply: true });
    assert.equal(result.deletedBytes, 0);
    assert.ok(result.entries.some(item => item.unitId === data.handle.id && item.reason === (mode === 'evidence' ? 'evidence-changed-or-incomplete' : 'cache-changed-after-shutdown')));
  }
});

test('Run overlay junctions are sealed without traversing targets; explicit linked evidence is rejected', async t => {
  const data = await populated(t);
  const external = path.join(data.root, 'installed-backend'); await mkdir(external); await writeFile(path.join(external, 'must-remain.jar'), 'backend');
  await symlink(external, path.join(data.run, 'backend-overlay'), process.platform === 'win32' ? 'junction' : 'dir');
  await seal(data);
  const result = await cleanupStorage(data.root, { apply: true }); assert.equal(result.deletedBytes, 4096);
  assert.equal(await readFile(path.join(external, 'must-remain.jar'), 'utf8'), 'backend');
  const other = await populated(t);
  const linked = path.join(other.run, 'linked-source'); await symlink(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
  other.report.source.diffPath = 'linked-source/must-remain.jar'; await saveReport(other.run, other.report);
  await assert.rejects(seal(other), /contains a link/);
});

test('partial deletion can retry a verified remaining subset, while an exclusive lock prevents concurrent apply', async t => {
  const data = await populated(t);
  const second = path.join(path.dirname(data.dependency), 'second.jar'); await writeFile(second, 'second'); await seal(data);
  await unlink(data.dependency); // Simulate interruption after the first file was unlinked.
  const lockFile = path.join(data.root, '.harness', 'storage', 'cleanup.lock'); await writeFile(lockFile, '{"pid":1}');
  await assert.rejects(cleanupStorage(data.root, { apply: true }), /locked/);
  await unlink(lockFile);
  const result = await cleanupStorage(data.root, { apply: true, unitIds: [data.handle.id] });
  assert.equal(result.deletedBytes, 6); assert.deepEqual(result.errors, []);
});

test('links replacing cache ancestors and malformed ownership records are retained', async t => {
  const data = await populated(t); await seal(data);
  await rm(data.cache, { recursive: true }); await symlink(data.run, data.cache, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await cleanupStorage(data.root, { apply: true }); assert.equal(result.deletedBytes, 0);
  assert.equal((await lstat(data.cache)).isSymbolicLink(), true);
  await writeFile(path.join(data.root, '.harness', 'storage', 'units', `${data.handle.id}.json`), '{broken');
  assert.equal((await cleanupStorage(data.root, { apply: true })).deletedBytes, 0);
});

test('failure to persist a pre-deletion audit prevents deletion', async t => {
  const data = await populated(t); await seal(data);
  await writeFile(path.join(data.root, '.harness', 'storage', 'audits'), 'blocks audit directory');
  await assert.rejects(cleanupStorage(data.root, { apply: true }));
  assert.equal((await lstat(data.dependency)).size, 4096);
  await assert.rejects(lstat(path.join(data.root, '.harness', 'storage', 'cleanup.lock')), { code: 'ENOENT' });
});

test('a project with no .harness can be inspected without creating storage state', async t => {
  const data = await fixture(t);
  const empty = path.join(data.root, 'empty-project'); await mkdir(empty);
  const result = await cleanupStorage(empty);
  assert.equal(result.totalBytes, 0); assert.equal(result.reclaimableBytes, 0); assert.deepEqual(result.entries, []);
  assert.ok(result.availableBytes === null || result.availableBytes >= 0);
  await assert.rejects(lstat(path.join(empty, '.harness')), { code: 'ENOENT' });
});

test('managed dependencies support long Windows paths and Unicode without escaping or losing retained evidence', async t => {
  const data = await populated(t);
  const dependency = path.join(data.cache, 'runtime', '日本語 の依存物', ...Array.from({ length: 7 }, (_, i) => `${i}-${'library'.repeat(4)}`), 'long.jar');
  assert.ok(dependency.length > 260);
  await mkdir(path.dirname(dependency), { recursive: true }); await writeFile(dependency, 'long dependency');
  await seal(data);
  const result = await cleanupStorage(data.root, { apply: true });
  assert.deepEqual(result.errors, []); assert.equal(result.deletedBytes, 4096 + Buffer.byteLength('long dependency'));
  assert.ok(result.entries.some(item => item.path.includes('日本語') && item.disposition === 'deleted'));
  assert.equal(await readFile(data.retained, 'utf8'), 'world evidence');
});

test('compact audits record exact managed paths and a retained complement without copying historical file lists', async t => {
  const data = await populated(t); await seal(data);
  const history = path.join(data.root, '.harness', 'runs', 'historical-large-run'); await mkdir(history);
  await Promise.all(Array.from({ length: 200 }, (_, i) => writeFile(path.join(history, `historic-${i}.log`), 'preserved history')));
  const unselectedCache = path.join(data.root, '.harness', 'c', randomUUID(), 'mct-cache', 'client');
  const unselectedUnit = await createStorageUnit(data.root, unselectedCache);
  await mkdir(unselectedCache, { recursive: true }); await writeFile(path.join(unselectedCache, 'active.jar'), 'active dependency');
  const result = await cleanupStorage(data.root, { apply: true, unitIds: [data.handle.id] });
  const auditText = await readFile(path.join(data.root, result.auditPath!), 'utf8'); const audit = JSON.parse(auditText);
  assert.equal(audit.auditSchemaVersion, 1); assert.equal(audit.entryScope, 'selected-managed-units');
  assert.equal(audit.retainedScope.root, '.harness'); assert.deepEqual(audit.retainedScope.exceptCacheRoots, [path.relative(data.root, data.cache).replaceAll('\\', '/')]);
  assert.ok(audit.entries.length > 0); assert.ok(audit.entries.every((item: any) => item.unitId === data.handle.id));
  assert.ok(audit.retainedScope.entryCount >= 200); assert.ok(audit.retainedScope.logicalBytes >= 200 * Buffer.byteLength('preserved history'));
  assert.ok(!auditText.includes('historic-')); assert.ok(!auditText.includes('active.jar'));
  assert.ok(result.entries.some(item => item.path.endsWith('historic-199.log') && item.disposition === 'retain'));
  assert.ok(result.entries.some(item => item.unitId === unselectedUnit.id && item.disposition === 'retain'));
  for (const entry of result.entries) {
    const excludedFromScope = audit.retainedScope.exceptCacheRoots.some((cacheRoot: string) => entry.path === cacheRoot || entry.path.startsWith(`${cacheRoot}/`));
    assert.equal(excludedFromScope, audit.entries.some((item: any) => item.path === entry.path));
    if (!excludedFromScope) assert.equal(entry.disposition, 'retain');
  }
});

test('a growing log from an unrelated active run does not prevent cleaning a sealed unit', async t => {
  const data = await populated(t); await seal(data);
  const activeRun = path.join(data.root, '.harness', 'runs', 'live-run'); await mkdir(activeRun);
  const log = path.join(activeRun, 'still-writing.log'); await writeFile(log, 'live evidence\n');
  let writing = true; let updates = 0;
  const writer = (async () => { while (writing) { await appendFile(log, 'progress\n'); updates++; await new Promise<void>(accept => setImmediate(accept)); } })();
  try {
    const result = await cleanupStorage(data.root, { apply: true, unitIds: [data.handle.id] });
    assert.equal(result.deletedBytes, 4096); assert.deepEqual(result.errors, []);
    assert.ok(result.entries.some(item => item.path.endsWith('still-writing.log') && item.disposition === 'retain'));
  } finally { writing = false; await writer; }
  assert.ok(updates > 0); assert.ok((await readFile(log, 'utf8')).startsWith('live evidence\n'));
});
