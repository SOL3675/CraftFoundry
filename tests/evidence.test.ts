import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectCrashReports } from '../dist/reporting/evidence.js';

test('crash evidence retains diagnosis and removes credentials', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mch crash ')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'crash-reports'));
  const file = path.join(root, 'crash-reports/crash.txt'); await writeFile(file, 'Fixture initialization failed\naccess_token=private-token\n');
  assert.deepEqual(await collectCrashReports(root), ['crash-reports/crash.txt']);
  assert.match(await readFile(file, 'utf8'), /Fixture initialization failed/);
  assert.equal((await readFile(file, 'utf8')).includes('private-token'), false);
});

test('a linked crash directory cannot expose or modify external files', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mch crash boundary ')); t.after(() => rm(root, { recursive: true, force: true }));
  const session = path.join(root, 'session'), outside = path.join(root, 'outside'); await mkdir(session); await mkdir(outside);
  await writeFile(path.join(outside, 'private.txt'), 'access_token=outside-secret');
  await symlink(outside, path.join(session, 'crash-reports'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await collectCrashReports(session), []);
  assert.equal(await readFile(path.join(outside, 'private.txt'), 'utf8'), 'access_token=outside-secret');
});
