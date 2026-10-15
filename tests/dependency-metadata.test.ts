import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { retainClientDependencyMetadata } from '../dist/reporting/dependency-metadata.js';
import { createStorageEvidenceSeal, validateStorageEvidenceSeal } from '../dist/reporting/storage-evidence.js';

async function fixture(t: test.TestContext) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'mch dependency metadata ')));
  t.after(() => rm(project, { recursive: true, force: true }));
  const cache = join(project, '.harness', 'c', randomUUID(), 'mct-cache');
  const run = join(project, '.harness', 'runs', 'metadata-run');
  await mkdir(cache, { recursive: true }); await mkdir(run, { recursive: true });
  const put = async (relative: string, content = '{"original":true}\n') => { const file = join(cache, relative); await mkdir(dirname(file), { recursive: true }); await writeFile(file, content); return file; };
  return { project, cache, run, put, retain: () => retainClientDependencyMetadata(project, cache, run) };
}

test('retention copies exact available version/index JSON into independent sealable Run evidence', async t => {
  const { project, cache, run, put, retain } = await fixture(t);
  const selected = ['client/runtime/1.21.1/versions/1.21.1/1.21.1.json', 'client/runtime/1.21.1/versions/neoforge-21.1.252/neoforge-21.1.252.json', 'client/runtime/1.21.1/assets/indexes/17.json'];
  for (const file of selected) await put(file);
  for (const file of ['client/runtime/1.21.1/versions/1.21.1/1.21.1.jar', 'client/runtime/1.21.1/versions/neoforge-21.1.252/neoforge-21.1.252-natives/.json', 'client/runtime/1.21.1/assets/objects/ab/object', 'client/runtime/1.21.1/.ready-neoforge-21.1.252', 'client/runtime/1.21.1/libraries/library.jar']) await put(file, 'excluded');
  const retained = await retain(); assert.equal(retained.length, 3);
  for (const relative of retained) {
    assert.match(relative, /^storage-dependencies\/[0-9a-f-]+\/client\/runtime\//u);
    assert.equal((await lstat(join(run, relative))).nlink, 1);
    assert.deepEqual(await readFile(join(run, relative)), await readFile(join(cache, relative.split('/').slice(2).join('/'))));
  }
  const seal = await createStorageEvidenceSeal(project, run, { scope: { target: 'target', suite: 'suite' }, files: retained });
  await rm(cache, { recursive: true });
  assert.equal((await validateStorageEvidenceSeal(run, seal)).files.length, 3);
});

test('missing selected directories are allowed and never claim installation completeness', async t => {
  const { put, retain } = await fixture(t);
  assert.deepEqual(await retain(), []);
  await put('client/runtime/1.20.1/libraries/installer.jar', 'jar');
  assert.deepEqual(await retain(), []);
  await put('client/runtime/1.20.1/assets/indexes/5.json', '{"available":"partial"}');
  assert.equal((await retain()).length, 1);
});

test('metadata retention rejects external roots, source links and unexpected selected paths', async t => {
  const { project, cache, run, put, retain } = await fixture(t);
  await assert.rejects(retainClientDependencyMetadata(project, project, run), /isolated/u);
  const outside = join(project, 'outside'); await mkdir(outside); await writeFile(join(outside, 'external.json'), '{}');
  await mkdir(join(cache, 'client/runtime/1.21.1'), { recursive: true });
  await symlink(outside, join(cache, 'client/runtime/1.21.1/versions'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(retain(), /links/u);
  await rm(join(cache, 'client/runtime/1.21.1/versions'));
  await put('client/runtime/1.21.1/versions/version/version.json');
  await put('client/runtime/1.21.1/assets/indexes/nested/no.json');
  await assert.rejects(retain(), /Unexpected dependency asset index/u);
});

test('installer index hardlinks are read without source changes and become independent seal inputs', async t => {
  const { project, cache, run, put, retain } = await fixture(t);
  const source = await put('client/runtime/1.21.1/assets/indexes/17.json', '{"objects":{}}\n');
  const alias = join(cache, 'client/runtime/1.21.1/assets/indexes', `${'a'.repeat(40)}.json`); await link(source, alias);
  const before = await lstat(source); const bytes = await readFile(source);
  const retained = await retain(); assert.equal(retained.length, 2);
  assert.equal((await lstat(source)).nlink, 2); assert.equal((await lstat(alias)).nlink, 2);
  assert.equal((await lstat(source)).ino, before.ino); assert.equal((await lstat(source)).mtimeMs, before.mtimeMs); assert.equal((await lstat(source)).ctimeMs, before.ctimeMs);
  assert.deepEqual(await readFile(source), bytes); assert.deepEqual(await readFile(alias), bytes);
  for (const file of retained) { assert.equal((await lstat(join(run, file))).nlink, 1); assert.deepEqual(await readFile(join(run, file)), bytes); }
  const seal = await createStorageEvidenceSeal(project, run, { scope: { target: 'target', suite: 'suite' }, files: retained });
  assert.equal((await validateStorageEvidenceSeal(run, seal)).files.length, 2);
});

test('count, per-file size, total size and traversal depth bounds fail before exposing evidence', async t => {
  for (const mode of ['count', 'file-size', 'total-size', 'depth']) {
    const { put, retain } = await fixture(t);
    if (mode === 'count') for (let index = 0; index < 257; index++) await put(`client/runtime/1.21.1/versions/version/${index}.json`);
    if (mode === 'file-size' || mode === 'total-size') {
      for (let index = 0; index < (mode === 'file-size' ? 1 : 5); index++) {
        const file = await put(`client/runtime/1.21.1/versions/version/${index}.json`);
        const handle = await open(file, 'r+'); try { await handle.truncate((mode === 'file-size' ? 17 : 16) * 1024 * 1024); } finally { await handle.close(); }
      }
    }
    if (mode === 'depth') await put(`client/runtime/1.21.1/versions/${Array(18).fill('nested').join('/')}/metadata.json`);
    await assert.rejects(retain(), /limit|bounded/u);
  }
});

test('separate calls produce fresh evidence sets without overwriting earlier retained metadata', async t => {
  const { run, put, retain } = await fixture(t);
  const source = await put('client/runtime/1.21.1/versions/version/version.json', '{"version":1}');
  const first = await retain(); await writeFile(source, '{"version":2}'); const second = await retain();
  assert.notEqual(first[0], second[0]);
  assert.equal(await readFile(join(run, first[0]!), 'utf8'), '{"version":1}');
  assert.equal(await readFile(join(run, second[0]!), 'utf8'), '{"version":2}');
});
