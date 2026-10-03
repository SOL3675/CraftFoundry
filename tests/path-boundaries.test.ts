import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRun } from '../dist/reporting/report.js';
import { resolveTool } from '../dist/core/cache.js';
import { assertContainedPath } from '../dist/core/paths.js';
import type { LoadedConfig } from '../src/core/types.ts';

async function directories(t: any) {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'mch containment ')));
  const root = path.join(temporary, 'project');
  const external = path.join(temporary, 'external');
  await Promise.all([mkdir(root), mkdir(external)]);
  t.after(async () => {
    assert.equal(await realpath(temporary), temporary);
    await rm(temporary, { recursive: true, force: true });
  });
  return { root, external };
}
function loaded(root: string): LoadedConfig {
  return { root, config: { schemaVersion: 1, projectId: 'test', builds: {}, targets: {}, suites: {}, runtimes: {} },
    local: { schemaVersion: 1 }, lock: { schemaVersion: 1, tools: { helper: { version: '1', sha256: 'a'.repeat(64), url: 'https://example.invalid/helper.jar' } } } };
}
async function redirect(root: string, relative: string, external: string) {
  const location = path.join(root, relative);
  await mkdir(path.dirname(location), { recursive: true });
  await symlink(external, location, process.platform === 'win32' ? 'junction' : 'dir');
}

test('Run creation refuses escaping .harness and runs links before writing evidence', async (t) => {
  for (const relative of ['.harness', '.harness/runs']) {
    const { root, external } = await directories(t);
    await redirect(root, relative, external);
    await assert.rejects(createRun(loaded(root), 'mch inspect --all'), /outside project root/);
    assert.deepEqual(await readdir(external), []);
  }
});

test('locked tool download refuses escaping .harness, cache and downloads links before creating cache or locks', async (t) => {
  for (const relative of ['.harness', '.harness/cache', '.harness/cache/downloads']) {
    const { root, external } = await directories(t);
    await redirect(root, relative, external);
    await assert.rejects(resolveTool(loaded(root), 'helper'), /outside project root/);
    assert.deepEqual(await readdir(external), []);
  }
});

test('path checks accept a new contained directory but refuse outside source reads through a parent link', async (t) => {
  const { root, external } = await directories(t);
  await writeFile(path.join(external, 'source.java'), 'external source');
  await assertContainedPath(root, path.join(root, '.harness', 'runs', 'new-run'));
  await redirect(root, 'linked-source', external);
  await assert.rejects(assertContainedPath(root, path.join(root, 'linked-source', 'source.java')), /outside project root/);
  await assert.rejects(assertContainedPath(root, path.join(external, 'source.java')), /escapes project root/);
});


test('trusted root aliases accept existing and missing descendants but reject redirected children', async t => {
  const { root, external } = await directories(t);
  const alias = path.join(path.dirname(root), 'project-alias');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(root, 'owned.txt'), 'owned');
  await assertContainedPath(alias, path.join(alias, 'owned.txt'));
  await assertContainedPath(alias, path.join(alias, 'missing', 'child'));
  await assertContainedPath(alias, path.join(root, 'missing', 'child'));
  await redirect(root, 'escape', external);
  await assert.rejects(assertContainedPath(alias, path.join(alias, 'escape', 'missing')), /resolves outside project root/);
  await assert.rejects(assertContainedPath(alias, path.join(external, 'missing')), /escapes project root/);
  assert.deepEqual(await readdir(external), []);
});

test('raw temporary-root spelling stays contained after realpath normalization', async t => {
  // GitHub Windows runners use an 8.3 TEMP parent; do not normalize this input.
  const root = await mkdtemp(path.join(tmpdir(), 'mch raw temp '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assertContainedPath(root, path.join(root, 'new', 'child'));
  await writeFile(path.join(root, 'existing.txt'), 'owned');
  await assertContainedPath(root, path.join(root, 'existing.txt'));
});
