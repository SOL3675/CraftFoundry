import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installMcPilot, validateMcPilotInstallation } from '../dist/core/tools.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'mch tools 日本語 '));
  const templateRoot = path.join(root, 'test-template'); await mkdir(templateRoot);
  const tarball = Buffer.from('offline npm tarball fixture');
  const helper = Buffer.from('offline helper fixture');
  const pins = { version: '0.15.0', url: 'https://example.com/mc-pilot.tgz', sha256: hash(tarball),
    helperUrl: 'https://example.com/helper.jar', helperSha256: hash(helper) };
  await writeFile(path.join(templateRoot, 'package.json'), JSON.stringify({ private: true, dependencies: { '@kzheart_/mc-pilot': '0.15.0' } }));
  const lock = { lockfileVersion: 3, packages: { 'node_modules/@kzheart_/mc-pilot': {
    version: '0.15.0', resolved: pins.url, integrity: 'sha512-' + createHash('sha512').update(tarball).digest('base64'),
  } } };
  await writeFile(path.join(templateRoot, 'package-lock.json'), JSON.stringify(lock));
  let requests = 0; let installs = 0; let installedVersion = '0.15.0';
  const dependencies = { templateRoot, pins,
    fetch: async (url: string) => { requests++; return new Response(url === pins.url ? tarball : helper); },
    runProcess: async (options: any) => {
      installs++;
      assert.ok(options.args.includes('--ignore-scripts'));
      assert.ok(options.args.includes('--no-audit'));
      assert.equal(options.args[0], 'ci');
      assert.equal(options.cwd, path.join(root, '.harness/tools/mc-pilot'));
      assert.ok(options.args[options.args.indexOf('--cache') + 1].startsWith(path.join(root, '.harness/cache')));
      assert.equal(options.args[options.args.indexOf('--prefix') + 1], options.cwd);
      const backend = path.join(options.cwd, 'node_modules/@kzheart_/mc-pilot');
      await mkdir(path.join(backend, 'dist/instance'), { recursive: true });
      await mkdir(path.join(backend, 'dist/util'), { recursive: true });
      await mkdir(path.join(backend, 'dist/client'), { recursive: true });
      await writeFile(path.join(backend, 'package.json'), JSON.stringify({ name: '@kzheart_/mc-pilot', version: installedVersion }));
      for (const file of ['dist/instance/ClientInstanceManager.js', 'dist/util/process.js', 'dist/client/WebSocketClient.js']) {
        await writeFile(path.join(backend, file), 'export const fixture = true;');
      }
      return { status: 'passed', exitCode: 0, signal: null, durationMs: 1, stdout: '', stderr: '',
        logs: { stdout: path.join(options.logDir, 'stdout.log'), stderr: path.join(options.logDir, 'stderr.log') } };
    },
  };
  return { root, templateRoot, pins, lock, dependencies, options: { npmCommand: process.execPath },
    counters: () => ({ requests, installs }), setVersion: (value: string) => { installedVersion = value; },
    cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('pinned local install disables hooks, verifies package/helper and reuses matching managed files', async () => {
  const f = await fixture();
  try {
    const installed = await installMcPilot(f.root, f.options, f.dependencies);
    assert.equal(installed.version, '0.15.0');
    assert.equal(installed.sha256, f.pins.sha256);
    assert.equal(hash(await readFile(installed.packageTarball)), f.pins.sha256);
    assert.equal(hash(await readFile(installed.helperJar)), f.pins.helperSha256);
    assert.ok(installed.backendRoot.startsWith(path.join(f.root, '.harness/tools/mc-pilot')));
    const reused = await installMcPilot(f.root, f.options, f.dependencies);
    assert.deepEqual(reused, installed);
    assert.deepEqual(f.counters(), { requests: 2, installs: 1 });
    const metadata = JSON.parse(await readFile(path.join(f.root, '.harness/tools/mc-pilot/.mch-mc-pilot.json'), 'utf8'));
    assert.equal(metadata.lockSha256, hash(await readFile(installed.lockfile)));
    assert.ok(Object.keys(metadata.files).includes('@kzheart_/mc-pilot/dist/util/process.js'));
    await writeFile(path.join(installed.backendRoot, 'dist/util/process.js'), 'modified backend');
    await assert.rejects(installMcPilot(f.root, f.options, f.dependencies), /package contents changed/);
    assert.equal(f.counters().installs, 1);
  } finally { await f.cleanup(); }
});

test('download hash mismatch prevents npm invocation and cleans cache partial files', async () => {
  const f = await fixture();
  try {
    const wrong = { ...f.dependencies, fetch: async () => new Response('wrong download') };
    await assert.rejects(installMcPilot(f.root, f.options, wrong), /Downloaded mc-pilot hash mismatch/);
    assert.equal(f.counters().installs, 0);
    assert.deepEqual(await readdir(path.join(f.root, '.harness/cache/mc-pilot-downloads')), []);
    assert.deepEqual(await readdir(path.join(f.root, '.harness/tools/mc-pilot')), []);
  } finally { await f.cleanup(); }
});

test('npm lock SHA512 must agree with the independently verified SHA256 tarball', async () => {
  const f = await fixture();
  try {
    f.lock.packages['node_modules/@kzheart_/mc-pilot'].integrity = 'sha512-' + Buffer.alloc(64).toString('base64');
    await writeFile(path.join(f.templateRoot, 'package-lock.json'), JSON.stringify(f.lock));
    await assert.rejects(installMcPilot(f.root, f.options, f.dependencies), /tarball integrity differs/);
    assert.equal(f.counters().installs, 0);
  } finally { await f.cleanup(); }
});

test('unexpected installed backend version is rejected without managed metadata', async () => {
  const f = await fixture();
  try {
    f.setVersion('0.14.0');
    await assert.rejects(installMcPilot(f.root, f.options, f.dependencies), /identity\/version mismatch/);
    assert.ok(!(await readdir(path.join(f.root, '.harness/tools/mc-pilot'))).includes('.mch-mc-pilot.json'));
    await assert.rejects(installMcPilot(f.root, f.options, f.dependencies), /directory is unmanaged/);
  } finally { await f.cleanup(); }
});

test('unmanaged tool collision and project junction escape are refused before network access', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, '.harness/tools/mc-pilot'), { recursive: true });
    await writeFile(path.join(f.root, '.harness/tools/mc-pilot/user.txt'), 'keep');
    await assert.rejects(installMcPilot(f.root, f.options, f.dependencies), /directory is unmanaged/);
    assert.equal(await readFile(path.join(f.root, '.harness/tools/mc-pilot/user.txt'), 'utf8'), 'keep');
    assert.equal(f.counters().requests, 0);
    await rm(path.join(f.root, '.harness'), { recursive: true });
    const outside = path.join(f.root, 'outside'); await mkdir(outside);
    await symlink(outside, path.join(f.root, '.harness'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(installMcPilot(f.root, f.options, f.dependencies), /symbolic link/);
    assert.deepEqual(await readdir(outside), []);
  } finally { await f.cleanup(); }
});

test('cancelled installation creates no tool state', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(installMcPilot(f.root, { ...f.options, signal: controller.signal }, f.dependencies), /abort/i);
    assert.deepEqual(await readdir(f.root), ['test-template']);
    assert.deepEqual(f.counters(), { requests: 0, installs: 0 });
  } finally { await f.cleanup(); }
});

test('read-only backend preflight verifies executable identity independent of metadata key order and rejects tampering', async () => {
  const f = await fixture();
  try {
    const installed = await installMcPilot(f.root, f.options, f.dependencies);
    const before = f.counters();
    const identity = await validateMcPilotInstallation(installed.backendRoot, f.pins, f.dependencies);
    assert.equal(identity.sha256, f.pins.sha256); assert.equal(identity.files, 4); assert.match(identity.treeSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(f.counters(), before, 'preflight must not download or install');
    const file = path.join(f.root, '.harness/tools/mc-pilot/.mch-mc-pilot.json');
    const metadata = JSON.parse(await readFile(file, 'utf8'));
    metadata.files = Object.fromEntries(Object.entries(metadata.files).reverse());
    await writeFile(file, JSON.stringify(metadata));
    assert.equal((await validateMcPilotInstallation(installed.backendRoot, f.pins, f.dependencies)).treeSha256, identity.treeSha256);
    const metadataBytes = await readFile(file);
    await writeFile(path.join(installed.backendRoot, 'dist/util/process.js'), 'modified executable');
    await assert.rejects(validateMcPilotInstallation(installed.backendRoot, f.pins, f.dependencies), /executable tree differs/);
    assert.deepEqual(await readFile(file), metadataBytes, 'preflight must not repair the recorded tree');
    assert.deepEqual(f.counters(), before);
  } finally { await f.cleanup(); }
});

test('read-only backend preflight refuses missing metadata, wrong pins and redirected executable directories', async () => {
  const f = await fixture();
  try {
    const installed = await installMcPilot(f.root, f.options, f.dependencies);
    await assert.rejects(validateMcPilotInstallation(installed.backendRoot, { ...f.pins, sha256: '0'.repeat(64) }, f.dependencies), /lock does not match/);
    const metadataFile = path.join(f.root, '.harness/tools/mc-pilot/.mch-mc-pilot.json');
    const metadataBytes = await readFile(metadataFile); await rm(metadataFile);
    await assert.rejects(validateMcPilotInstallation(installed.backendRoot, f.pins, f.dependencies), /no managed installation metadata/);
    assert.ok(!(await readdir(path.dirname(metadataFile))).includes('.mch-mc-pilot.json'));
    await writeFile(metadataFile, metadataBytes);
    await rm(path.join(installed.backendRoot, 'dist/util'), { recursive: true });
    const external = path.join(f.root, 'external'); await mkdir(external);
    await writeFile(path.join(external, 'process.js'), 'external bytes');
    await symlink(external, path.join(installed.backendRoot, 'dist/util'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(validateMcPilotInstallation(installed.backendRoot, f.pins, f.dependencies), /symbolic link/);
    assert.equal(await readFile(path.join(external, 'process.js'), 'utf8'), 'external bytes');
  } finally { await f.cleanup(); }
});
