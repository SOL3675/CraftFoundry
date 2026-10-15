import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, stat, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SharedAssets } from '../dist/core/shared-assets.js';

const hash = (content: Buffer | string) => createHash('sha1').update(content).digest('hex');
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'mch shared assets '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const shared = new SharedAssets(join(root, 'store')); await shared.initialize();
  return { root, shared };
}

test('shared assets retain only bounded hash-verified addressed objects and indexes', async t => {
  const { root, shared } = await fixture(t);
  const source = join(root, 'source'); const content = Buffer.from('verified asset'); const name = hash(content);
  await mkdir(join(source, 'objects', name.slice(0, 2)), { recursive: true });
  await writeFile(join(source, 'objects', name.slice(0, 2), name), content);
  const index = Buffer.from(JSON.stringify({ objects: { sound: { hash: name, size: content.length } } }));
  await mkdir(join(source, 'indexes')); await writeFile(join(source, 'indexes', `${hash(index)}.json`), index);
  await writeFile(join(source, 'indexes', '17.json'), 'mutable version alias');
  await writeFile(join(source, '.ready-windows'), 'not reusable');
  await mkdir(join(source, 'world')); await writeFile(join(source, 'world', 'level.dat'), 'world');
  await shared.capture(source);
  assert.equal(shared.stats.importedFiles, 2); assert.equal(shared.stats.importedBytes, content.length + index.length);
  assert.deepEqual((await readdir(shared.root)).sort(), ['OWNER', 'indexes', 'objects']);
  assert.deepEqual(await readdir(join(shared.root, 'indexes')), [`${hash(index)}.json`]);
  await shared.seed(join(root, 'session'));
  const sessionObject = join(root, 'session', 'objects', name.slice(0, 2), name);
  assert.equal((await stat(sessionObject)).nlink, 1);
  assert.equal(shared.stats.clonedFiles + shared.stats.copiedFiles, 2);
  // This must remain safe even when the game overwrites its own asset file.
  await writeFile(sessionObject, 'game mutation');
  assert.deepEqual(await readFile(join(shared.root, 'objects', name.slice(0, 2), name)), content);
  await assert.rejects(shared.seed(join(root, 'session')), /SHA-1 mismatch/u);
});

test('concurrent publishers converge without accepting partial files or overwriting corrupt cache', async t => {
  const { root, shared } = await fixture(t); const content = Buffer.alloc(256 * 1024, 71); const name = hash(content);
  const stores = Array.from({ length: 8 }, () => new SharedAssets(shared.root));
  await Promise.all(stores.map(store => store.initialize()));
  await Promise.all(stores.map(store => store.materialize('objects', name, content, join(root, `session-${stores.indexOf(store)}`, name))));
  assert.equal(stores.reduce((total, store) => total + store.stats.importedFiles, 0), 1);
  const stored = join(shared.root, 'objects', name.slice(0, 2), name);
  assert.equal((await stat(stored)).nlink, 1);
  assert.deepEqual(await readFile(stored), content);
  await writeFile(stored, 'corrupt');
  await assert.rejects(shared.retain('objects', name, content), /SHA-1 mismatch/u);
  assert.equal(await readFile(stored, 'utf8'), 'corrupt');
});

test('interrupted temporary files are ignored and aborted work does not publish', async t => {
  const { root, shared } = await fixture(t); const content = Buffer.from('asset'); const name = hash(content);
  await mkdir(join(shared.root, 'objects', name.slice(0, 2)), { recursive: true });
  await writeFile(join(shared.root, 'objects', name.slice(0, 2), '.asset-aborted.tmp'), 'partial');
  await shared.seed(join(root, 'session')); assert.equal(shared.stats.copiedFiles + shared.stats.clonedFiles, 0);
  const controller = new AbortController(); controller.abort();
  const cancelled = new SharedAssets(shared.root, controller.signal);
  await assert.rejects(cancelled.retain('objects', name, content), /abort/iu);
  await assert.rejects(readFile(join(shared.root, 'objects', name.slice(0, 2), name)), /ENOENT/u);
});

test('unowned roots, symlink traversal, hardlinked input and invalid indexes fail closed', async t => {
  const { root, shared } = await fixture(t);
  const unowned = join(root, 'unowned'); await mkdir(unowned); await writeFile(join(unowned, 'keep'), 'unrelated');
  await assert.rejects(new SharedAssets(unowned).initialize(), /unowned/u);
  const malformed = Buffer.from('{"objects":{"x":{"hash":"bad","size":1}}}');
  await assert.rejects(shared.retain('indexes', `${hash(malformed)}.json`, malformed), /Invalid shared asset index/u);
  const external = join(root, 'external'); await mkdir(external);
  await symlink(external, join(shared.root, 'objects'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(shared.seed(join(root, 'session')), /symbolic links/u);
  await rm(join(shared.root, 'objects'));
  const content = Buffer.from('asset'); const name = hash(content);
  await writeFile(join(root, 'original'), content); await mkdir(join(shared.root, 'objects', name.slice(0, 2)), { recursive: true });
  await link(join(root, 'original'), join(shared.root, 'objects', name.slice(0, 2), name));
  await assert.rejects(shared.seed(join(root, 'session')), /one owner/u);
});
