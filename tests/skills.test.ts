import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installSkills } from '../dist/core/skills.js';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'mch skills 日本語 '));
  const sourceRoot = path.join(root, 'bundle');
  const destination = path.join(root, 'installed');
  await mkdir(path.join(sourceRoot, 'project-setup/references'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'development-loop'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'project-setup/SKILL.md'), 'setup version one');
  await writeFile(path.join(sourceRoot, 'project-setup/references/config.md'), 'config version one');
  await writeFile(path.join(sourceRoot, 'development-loop/SKILL.md'), 'loop version one');
  return { root, sourceRoot, destination, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('bundled install records package version and per-file SHA256; repeated install is unchanged', async () => {
  const f = await fixture();
  try {
    const installed = await installSkills(f.destination);
    assert.equal(installed.version, version);
    assert.equal(installed.installed.length, 4);
    assert.deepEqual(installed.updated, []);
    assert.deepEqual(installed.preserved, []);
    const metadata = JSON.parse(await readFile(path.join(f.destination, '.mch-skills.json'), 'utf8'));
    for (const name of installed.installed) {
      assert.equal(metadata.files[name].sha256, createHash('sha256').update(await readFile(path.join(f.destination, name))).digest('hex'));
      assert.equal(metadata.files[name].version, installed.version);
    }
    assert.deepEqual(await installSkills(f.destination), { version, installed: [], updated: [], preserved: [] });
    assert.ok(!(await readdir(f.destination)).some(name => name.endsWith('.tmp') || name.endsWith('.lock')));
  } finally { await f.cleanup(); }
});

test('upgrades only untouched managed files and keeps original provenance for user edits', async () => {
  const f = await fixture();
  try {
    assert.equal((await installSkills(f.destination, { sourceRoot: f.sourceRoot, version: '1.0.0' })).installed.length, 3);
    await writeFile(path.join(f.destination, 'project-setup/SKILL.md'), 'my custom setup');
    await writeFile(path.join(f.sourceRoot, 'project-setup/SKILL.md'), 'setup version two');
    await writeFile(path.join(f.sourceRoot, 'project-setup/references/config.md'), 'config version two');
    await writeFile(path.join(f.sourceRoot, 'development-loop/SKILL.md'), 'loop version two');
    const result = await installSkills(f.destination, { sourceRoot: f.sourceRoot, version: '1.1.0' });
    assert.deepEqual(result.updated.sort(), ['development-loop/SKILL.md', 'project-setup/references/config.md']);
    assert.deepEqual(result.preserved, ['project-setup/SKILL.md']);
    assert.equal(await readFile(path.join(f.destination, 'project-setup/SKILL.md'), 'utf8'), 'my custom setup');
    assert.equal(await readFile(path.join(f.destination, 'project-setup/references/config.md'), 'utf8'), 'config version two');
    const metadata = JSON.parse(await readFile(path.join(f.destination, '.mch-skills.json'), 'utf8'));
    assert.deepEqual(metadata.files['project-setup/SKILL.md'], { sha256: digest('setup version one'), version: '1.0.0' });
    assert.equal(metadata.files['development-loop/SKILL.md'].version, '1.1.0');
    const repeated = await installSkills(f.destination, { sourceRoot: f.sourceRoot, version: '1.1.0' });
    assert.deepEqual(repeated.updated, []);
    assert.deepEqual(repeated.preserved, ['project-setup/SKILL.md']);
  } finally { await f.cleanup(); }
});

test('existing unrecorded files stay unmanaged; missing recorded files can be reinstalled', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.destination, 'project-setup'), { recursive: true });
    await writeFile(path.join(f.destination, 'project-setup/SKILL.md'), 'existing user skill');
    const options = { sourceRoot: f.sourceRoot, version: '1.0.0' };
    const first = await installSkills(f.destination, options);
    assert.deepEqual(first.preserved, ['project-setup/SKILL.md']);
    const metadata = JSON.parse(await readFile(path.join(f.destination, '.mch-skills.json'), 'utf8'));
    assert.equal(metadata.files['project-setup/SKILL.md'], undefined);
    await rm(path.join(f.destination, 'development-loop/SKILL.md'));
    const second = await installSkills(f.destination, options);
    assert.deepEqual(second.installed, ['development-loop/SKILL.md']);
    assert.deepEqual(second.preserved, ['project-setup/SKILL.md']);
    assert.equal(await readFile(path.join(f.destination, 'project-setup/SKILL.md'), 'utf8'), 'existing user skill');
  } finally { await f.cleanup(); }
});

test('invalid or traversal installation metadata rejects before modifying skill files', async () => {
  const f = await fixture();
  try {
    await mkdir(f.destination);
    await writeFile(path.join(f.destination, '.mch-skills.json'), JSON.stringify({ schemaVersion: 1, version: '1.0.0',
      files: { '../outside.txt': { sha256: digest('x'), version: '1.0.0' } } }));
    await assert.rejects(installSkills(f.destination, { sourceRoot: f.sourceRoot, version: '1.1.0' }), /Invalid skill manifest path/);
    assert.deepEqual(await readdir(f.destination), ['.mch-skills.json']);
    await writeFile(path.join(f.destination, '.mch-skills.json'), JSON.stringify({ schemaVersion: 1, version: '1.0.0',
      files: { 'project-setup/SKILL.md': { sha256: 'invalid', version: '1.0.0' } } }));
    await assert.rejects(installSkills(f.destination, { sourceRoot: f.sourceRoot, version: '1.1.0' }), /Invalid skill installation record/);
    assert.deepEqual(await readdir(f.destination), ['.mch-skills.json']);
  } finally { await f.cleanup(); }
});

test('linked skill directories cannot escape destination and remain untouched', async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.root, 'outside');
    await mkdir(outside); await mkdir(f.destination);
    await writeFile(path.join(outside, 'SKILL.md'), 'outside untouched');
    await symlink(outside, path.join(f.destination, 'development-loop'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(installSkills(f.destination, { sourceRoot: f.sourceRoot, version: '1.0.0' }), /symbolic link/);
    assert.equal(await readFile(path.join(outside, 'SKILL.md'), 'utf8'), 'outside untouched');
    assert.deepEqual(await readdir(f.destination), ['development-loop']);
  } finally { await f.cleanup(); }
});

test('an existing installation lock is retained and blocks concurrent writes', async () => {
  const f = await fixture();
  try {
    await mkdir(f.destination);
    await writeFile(path.join(f.destination, '.mch-skills.lock'), 'another-owner');
    await assert.rejects(installSkills(f.destination, { sourceRoot: f.sourceRoot, version: '1.0.0' }), /destination is locked/);
    assert.equal(await readFile(path.join(f.destination, '.mch-skills.lock'), 'utf8'), 'another-owner');
    assert.deepEqual(await readdir(f.destination), ['.mch-skills.lock']);
  } finally { await f.cleanup(); }
});
