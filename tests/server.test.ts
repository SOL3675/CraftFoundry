import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OwnedServer } from '../dist/adapters/runtime/server.js';
import { resolveTool } from '../dist/core/cache.js';

test('dedicated server preparation isolates mods by side and hash, waits for readiness then stops gracefully', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mch サーバー '));
  try {
    await mkdir(path.join(root, 'artifacts'));
    const jar = Buffer.from('contract fixture, not a real Minecraft JAR');
    const sha256 = createHash('sha256').update(jar).digest('hex');
    await writeFile(path.join(root, 'artifacts', 'fixture.jar'), jar);
    const script = path.join(root, 'server.mjs');
    await writeFile(script, `process.stdout.write('Done ready\\n'); process.stdin.on('data', b => { if(b.toString().includes('stop')) { process.stdout.write('Saving world\\n');process.exit(0); } });`);
    const loaded = { root, config: { targets: { target: {} } }, local: { schemaVersion: 1, eulaAccepted: true, timeouts: { start: 10_000, test: 15_000, stop: 3_000 } }, lock: { schemaVersion: 1, tools: {} } };
    const runtime = { kind: 'server', capabilities: [], command: { executable: process.execPath, args: [script] }, readyPattern: 'Done ready' };
    const server = new OwnedServer(loaded as any, 'target', runtime as any, path.join(root, 'session'), path.join(root, 'logs'));
    const artifacts = [
      { path: 'artifacts/fixture.jar', sha256, size: jar.length, kind: 'distribution', side: 'both', originalPath: 'fixture.jar' },
      { path: 'artifacts/missing-client.jar', sha256, size: jar.length, kind: 'runtime-dependency', side: 'client', originalPath: 'missing-client.jar' },
      { path: 'artifacts/missing-sources.jar', sha256, size: jar.length, kind: 'sources', side: 'both', originalPath: 'missing-sources.jar' },
    ];
    await server.prepare(artifacts as any, root);
    assert.ok(server.port > 0);
    const record = JSON.parse(await readFile(path.join(server.directory, 'session.json'), 'utf8'));
    assert.equal(record.deployed.length, 1); assert.equal(record.bind, '127.0.0.1');
    await server.start(); await server.waitReady();
    const stopped = await server.stop();
    assert.equal(stopped?.exitCode, 0); assert.match(stopped!.stdout, /Saving world/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('server cannot auto-accept EULA or deploy a modified distribution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mch server rejection '));
  try {
    const loaded = { root, config: { targets: { target: {} } }, local: { schemaVersion: 1 }, lock: { schemaVersion: 1, tools: {} } };
    const runtime = { kind: 'server', capabilities: [], command: { executable: process.execPath, args: [] }, readyPattern: 'ready' };
    const server = new OwnedServer(loaded as any, 'target', runtime as any, path.join(root, 'session'), path.join(root, 'logs'));
    await assert.rejects(server.prepare([], root), /EULA/);
    loaded.local = { ...loaded.local, eulaAccepted: true } as any;
    await writeFile(path.join(root, 'bad.jar'), 'changed');
    await assert.rejects(server.prepare([{ path: 'bad.jar', sha256: '0'.repeat(64), kind: 'distribution', side: 'both' }] as any, root), /hash changed/);
    await server.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local runtime tools require a matching pinned hash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mch tool hash '));
  try {
    const file = path.join(root, 'tool.jar'); await writeFile(file, 'pinned');
    const sha256 = createHash('sha256').update('pinned').digest('hex');
    const loaded = { root, local: { tools: { tool: file } }, lock: { tools: { tool: { version: '1.0.0', sha256 } } } };
    assert.equal(await resolveTool(loaded as any, 'tool'), file);
    await writeFile(file, 'different'); await assert.rejects(resolveTool(loaded as any, 'tool'), /hash mismatch/);
    await assert.rejects(resolveTool(loaded as any, 'absent'), /must be pinned/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime installer failure is reported before starting a server and retains setup logs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mch installer failure '));
  try {
    await writeFile(path.join(root, 'fixture.jar'), 'jar');
    const sha256 = createHash('sha256').update('jar').digest('hex');
    const loaded = { root, config: { targets: { target: {} } }, local: { schemaVersion: 1, eulaAccepted: true }, lock: { schemaVersion: 1, tools: {} } };
    const runtime = { kind: 'server', capabilities: [], command: { executable: process.execPath, args: [] }, setup: { executable: process.execPath, args: ['-e', 'console.error("installer broke");process.exit(9)'] }, readyPattern: 'ready' };
    const server = new OwnedServer(loaded as any, 'target', runtime as any, path.join(root, 'session'), path.join(root, 'logs'));
    try { await assert.rejects(server.prepare([{ path: 'fixture.jar', sha256, kind: 'distribution', side: 'both' }] as any, root), /Runtime setup failed/); }
    finally { await server.stop(); }
    assert.match(await readFile(path.join(server.directory, 'setup-logs', 'stderr.log'), 'utf8'), /installer broke/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('server evidence rejects redirected log directories without reading or redacting external files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mch server evidence '));
  try {
    const directory = path.join(root, 'session'); await mkdir(directory);
    const external = path.join(root, 'external'); await mkdir(external);
    const secret = 'token=outside-secret-must-not-change';
    await writeFile(path.join(external, 'latest.log'), secret);
    await symlink(external, path.join(directory, 'logs'), process.platform === 'win32' ? 'junction' : 'dir');
    const server = new OwnedServer({ root } as any, 'target', {} as any, directory, path.join(root, 'process-logs'));
    await assert.rejects(server.collectEvidence(), /resolves outside project root/);
    assert.equal(await readFile(path.join(external, 'latest.log'), 'utf8'), secret);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('server evidence refuses named file symlinks even when they point inside the owned session', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mch server evidence link '));
  try {
    await writeFile(path.join(root, 'owned.txt'), 'token=original');
    await symlink(path.join(root, 'owned.txt'), path.join(root, 'session.json'), 'file');
    const server = new OwnedServer({ root } as any, 'target', {} as any, root, path.join(root, 'process-logs'));
    await assert.rejects(server.collectEvidence(), /not a regular owned file/);
    assert.equal(await readFile(path.join(root, 'owned.txt'), 'utf8'), 'token=original');
  } finally { await rm(root, { recursive: true, force: true }); }
});
