import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { retainResultDetails } from '../dist/reporting/result-details.js';
import type { TestCase } from '../src/reporting/types.ts';

test('retained references resolve escaped JSON pointers, preserve bytes and deduplicate companion files', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'Foundry details 日本語 '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = path.join(root, 'sessions/target/suite'); await mkdir(session, { recursive: true });
  const data = JSON.stringify({ 'a/b': { '~cause': 'Full detail 🌋 '.repeat(200000) } });
  const result = path.join(session, 'results.json'), detail = path.join(session, 'detail.json');
  await writeFile(result, '{}'); await writeFile(detail, data);
  const cases: TestCase[] = Array.from({ length: 20 }, (_, i) => ({ id: `case${i}`, status: 'unsupported', detail: { file: 'detail.json', pointer: '/a~1b/~0cause' } }));
  assert.deepEqual(await retainResultDetails(cases, result, root), ['sessions/target/suite/detail.json', 'sessions/target/suite/results.json']);
  assert.equal(await readFile(detail, 'utf8'), data);
  assert.ok(cases.every(c => c.detail!.file === 'sessions/target/suite/detail.json'));
  for (const file of ['missing.json', 'directory']) {
    if (file === 'directory') await mkdir(path.join(session, file));
    await assert.rejects(retainResultDetails([{ id: 'case', status: 'passed', detail: { file, pointer: '' } }], result, root));
  }
  await assert.rejects(retainResultDetails([{ id: 'case', status: 'passed', detail: { file: 'detail.json', pointer: '/absent' } }], result, root), /pointer/);
});

test('case detail files cannot escape the Run through symlinks', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'Foundry containment '));
  const outside = await mkdtemp(path.join(tmpdir(), 'Foundry outside '));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await writeFile(path.join(outside, 'detail.json'), '{"private":"keep outside"}');
  try { await symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('symlink creation unavailable'); return; } throw error; }
  await assert.rejects(retainResultDetails([{ id: 'case', status: 'unsupported', detail: { file: 'linked/detail.json', pointer: '' } }], path.join(root, 'results.json'), root), /outside/);
});
