import assert from 'node:assert/strict';
import test from 'node:test';
import { realpath, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { McPilotRuntimeAdapter } from '../dist/adapters/runtime/mc-pilot.js';

// These are backend protocol/ownership fixtures, not Minecraft test results.
async function fixture(t: test.TestContext, extra: Record<string, unknown> = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'mch pilot 空白 日本語 ')));
  const backendRoot = join(dir, 'node_modules', '@kzheart_', 'mc-pilot');
  for (const path of ['dist/util', 'dist/instance', 'dist/client', 'dist/download/client', 'scripts', 'data']) await mkdir(join(backendRoot, path), { recursive: true });
  await writeFile(join(backendRoot, 'package.json'), JSON.stringify({ name: '@kzheart_/mc-pilot', version: '0.15.0', type: 'module' }));
  await writeFile(join(backendRoot, 'dist/util/global-state.js'), 'export class GlobalStateStore {}');
  await writeFile(join(backendRoot, 'dist/util/process.js'), 'export const getListeningPids=()=>[process.ppid];export const isProcessRunning=()=>true;export const killProcessTree=()=>{throw Error("UNSAFE UPSTREAM KILL")};');
  await writeFile(join(backendRoot, 'dist/download/client/ClientDownloader.js'), `import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';export async function downloadClientModToDir(cwd,dir,options,dependencies={}){const minecraftDir=join(dir,'minecraft'),modsDir=join(minecraftDir,'mods'),jar=join(modsDir,'helper.jar');await mkdir(modsDir,{recursive:true});await writeFile(jar,'helper fixture');const variant={loader:options.loader,minecraftVersion:options.version,neoforgeVersion:'21.1.235',fabricLoaderVersion:'0.16.14',forgeVersion:'52.1.2'};const runtime=dependencies.prepareManagedRuntimeImpl?await dependencies.prepareManagedRuntimeImpl(variant,{runtimeRootDir:join(dir,'runtime'),gameDir:minecraftDir},{}):{};return{minecraftDir,modsDir,jar,variant,variantId:'fake',minecraftVersion:options.version,loader:options.loader,javaCommand:options.java,javaVersion:21,launchArgs:['dummy'],runtimeVersionId:runtime.versionId}}`);
  await writeFile(join(backendRoot, 'dist/download/client/FabricRuntimeDownloader.js'), `export async function prepareManagedClientRuntime(variant){return{versionId:variant.loader==='neoforge'?'neoforge-'+variant.neoforgeVersion:variant.loader==='fabric'?variant.minecraftVersion+'-fabric'+variant.fabricLoaderVersion:variant.minecraftVersion+'-forge-'+variant.forgeVersion}}`);
  await writeFile(join(backendRoot, 'scripts/client.mjs'), 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);');
  await writeFile(join(backendRoot, 'dist/instance/ClientInstanceManager.js'), `import{spawn}from'node:child_process';import{killProcessTree,isProcessRunning,getListeningPids}from'../util/process.js';import{fileURLToPath}from'node:url';export class ClientInstanceManager{async create(meta){this.meta=meta;return meta}async launch(name,options){if(getListeningPids(this.meta.wsPort).length)throw Error('unsafe port policy');const child=spawn(process.execPath,[fileURLToPath(new URL('../../scripts/client.mjs',import.meta.url))],{detached:true,stdio:'ignore'});this.entry={pid:child.pid,wsPort:this.meta.wsPort,name};child.unref();return this.entry}async waitReady(name,timeout,options){if(name.includes('hang'))await new Promise(()=>{});return{connected:true,inWorld:options.requireWorld===true,position:{x:0,y:64,z:0}}}async getClient(){return this.entry}async stop(){if(this.entry&&isProcessRunning(this.entry.pid))killProcessTree(this.entry.pid);return{stopped:true}}}`);
  await writeFile(join(backendRoot, 'dist/client/WebSocketClient.js'), `import{writeFile}from'node:fs/promises';import{killProcessTree}from'../util/process.js';export class WebSocketClient{constructor(url){this.url=url}async send(action,params){if(action==='test.fail')return{success:false,error:'INTENTIONAL_FAILURE'};if(action==='test.aggregate')throw new AggregateError([Object.assign(Error('connect failed'),{code:'ETIMEDOUT'}),Error('bad checksum')]);if(action==='policy.kill-outsider')killProcessTree(process.ppid);if(action==='capture.screenshot')await writeFile(params.output,Buffer.from([137,80,78,71,13,10,26,10]));return{success:true,data:{action,params,url:this.url}}}}`);
  const server = createServer(); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address === 'object'); const wsPort = address.port;
  await new Promise<void>(accept => server.close(() => accept()));
  const adapter = new McPilotRuntimeAdapter({ backendRoot, runDir: join(dir, 'run'), clientName: 'fixture-client', minecraft: '1.21.1', loader: 'fabric', java: process.execPath, wsPort, requestTimeoutMs: 10_000, sessionTimeoutMs: 30_000, stopTimeoutMs: 2_000, ...extra });
  t.after(async () => { try { await adapter.stop(); } catch {} await rm(dir, { recursive: true, force: true }); });
  return { dir, adapter, backendRoot, wsPort };
}

function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

async function waitForOwnedExit(pid: number): Promise<void> {
  // SIGKILL delivery to a process group can precede a child with ignored stdio actually exiting.
  const deadline = Date.now() + 3_000;
  while (alive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(alive(pid), false, 'owned mc-pilot client survived bounded cleanup');
}

test('mc-pilot broker isolates home/cache, preserves upstream bytes, owns client until stop', async t => {
  const { dir, adapter, backendRoot } = await fixture(t);
  const original = await readFile(join(backendRoot, 'dist/util/process.js'), 'utf8');
  const client = await adapter.create();
  assert.ok(client.minecraftDir.startsWith(resolve(dir, 'run', 'mct-home')));
  assert.equal(client.helperSha256, createHash('sha256').update('helper fixture').digest('hex'));
  const launch = await adapter.launch('127.0.0.1:25565'); const pid = Number(launch.pid);
  assert.equal(alive(pid), true);
  const ready = await adapter.waitReady(2_000); assert.equal(ready.inWorld, true);
  const response = await adapter.control('position.get'); assert.equal(response.action, 'position.get');
  const screenshot = await adapter.screenshot('fixture.png'); assert.ok((await readFile(screenshot)).length > 0);
  const stopped = await adapter.stop(); assert.equal(stopped?.status, 'passed'); await waitForOwnedExit(pid);
  assert.equal(await readFile(join(backendRoot, 'dist/util/process.js'), 'utf8'), original);
  assert.match(await readFile(join(dir, 'run', 'backend-overlay', 'HARNESS-OVERLAY.json'), 'utf8'), /no PID recovery/u);
});

test('mc-pilot does not convert a failed action or unowned PID stop into success', async t => {
  const { adapter } = await fixture(t); await adapter.create(); await adapter.launch();
  await assert.rejects(adapter.control('test.fail'), /INTENTIONAL_FAILURE/u);
  await assert.rejects(adapter.control('test.aggregate'), /AggregateError; connect failed; code=ETIMEDOUT; bad checksum/u);
  await assert.rejects(adapter.control('policy.kill-outsider'), /not owned/u);
  await adapter.stop();
});

test('mc-pilot refuses occupied WebSocket ports without terminating listeners', async t => {
  const { adapter, wsPort } = await fixture(t);
  const server = createServer(); await new Promise<void>(accept => server.listen(wsPort, '127.0.0.1', accept));
  t.after(() => new Promise<void>(accept => server.close(() => accept())));
  await assert.rejects(adapter.create(), /occupied; refusing/u);
  assert.equal(server.listening, true); await adapter.stop();
});

test('mc-pilot deploys only explicit hash-matching JARs and refuses overwrites', async t => {
  const { adapter, dir } = await fixture(t); await adapter.create();
  const artifact = join(dir, 'fixture.jar'); await writeFile(artifact, 'fixture mod');
  const hash = createHash('sha256').update('fixture mod').digest('hex');
  await assert.rejects(adapter.deployMod(artifact, '0'.repeat(64)), /mismatch/u);
  const deployed = await adapter.deployMod(artifact, hash); assert.equal(await readFile(deployed.path, 'utf8'), 'fixture mod');
  await assert.rejects(adapter.deployMod(artifact, hash), /EEXIST/u); await adapter.stop();
});

test('mc-pilot request timeout disposes the whole client session', async t => {
  const { adapter } = await fixture(t, { clientName: 'hang-client' });
  await adapter.create(); const launch = await adapter.launch(); const pid = Number(launch.pid);
  await assert.rejects(adapter.waitReady(10), /timed out/u);
  await assert.rejects(adapter.stop(), /cleanup/u);
  await waitForOwnedExit(pid);
});

test('explicit session cancellation disposes the owned client and reports completed cleanup', async t => {
  const controller = new AbortController();
  const { adapter } = await fixture(t, { signal: controller.signal });
  await adapter.create(); const launched = await adapter.launch(); const pid = Number(launched.pid);
  controller.abort();
  assert.equal((await adapter.stop())?.status, 'cancelled');
  await waitForOwnedExit(pid);
});

test('an exact NeoForge loader pin reaches the installer and replaces catalog metadata without editing upstream', async t => {
  const { adapter, backendRoot } = await fixture(t, { loader: 'neoforge', loaderVersion: '21.1.252' });
  const before = await readFile(join(backendRoot, 'dist/download/client/ClientDownloader.js'), 'utf8');
  const client = await adapter.create();
  assert.equal(client.runtimeVersionId, 'neoforge-21.1.252');
  assert.equal(client.loaderVersion, '21.1.252'); assert.equal(client.catalogLoaderVersion, '21.1.235');
  assert.equal((client.variant as { neoforgeVersion: string }).neoforgeVersion, '21.1.252');
  assert.equal(await readFile(join(backendRoot, 'dist/download/client/ClientDownloader.js'), 'utf8'), before);
  await adapter.stop();
});

test('a pinned loader cannot silently accept a backend installer returning another runtime', async t => {
  const { adapter, backendRoot } = await fixture(t, { loader: 'neoforge', loaderVersion: '21.1.252' });
  await writeFile(join(backendRoot, 'dist/download/client/FabricRuntimeDownloader.js'), `export async function prepareManagedClientRuntime(){return{versionId:'neoforge-21.1.235'}}`);
  await assert.rejects(adapter.create(), /does not match requested loader/u);
  await adapter.stop();
});

test('backend installer Java children use the explicit game executable without relying on PATH', async t => {
  const { adapter, backendRoot } = await fixture(t, { loader: 'neoforge', loaderVersion: '21.1.252' });
  await writeFile(join(backendRoot, 'dist/download/client/FabricRuntimeDownloader.js'), `import{spawn}from'node:child_process';export async function prepareManagedClientRuntime(variant){await new Promise((resolve,reject)=>{const child=spawn('java',['--version'],{stdio:'ignore',env:{PATH:''}});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('wrong Java executable')))});return{versionId:'neoforge-'+variant.neoforgeVersion}}`);
  assert.equal((await adapter.create()).runtimeVersionId, 'neoforge-21.1.252');
  await adapter.stop();
});

test('asset seeds are content-addressed and do not import ready markers or platform libraries', async t => {
  const { dir, backendRoot } = await fixture(t);
  const objects = join(dir, 'asset-objects'); const content = Buffer.from('immutable asset');
  const hash = createHash('sha1').update(content).digest('hex');
  await mkdir(join(objects, hash.slice(0, 2)), { recursive: true }); await writeFile(join(objects, hash.slice(0, 2), hash), content);
  await writeFile(join(objects, '.ready-windows'), 'must not copy');
  const index = Buffer.from(JSON.stringify({ objects: { 'minecraft/asset': { hash, size: content.length } } }));
  const indexHash = createHash('sha1').update(index).digest('hex');
  await mkdir(join(dir, 'indexes')); await writeFile(join(dir, 'indexes', `${indexHash}.json`), index);
  await writeFile(join(dir, 'indexes', '17.json'), 'unverified alias must not copy');
  const adapter = new McPilotRuntimeAdapter({ backendRoot, runDir: join(dir, 'seed-run'), clientName: 'seeded', minecraft: '1.21.1', loader: 'fabric', java: process.execPath, wsPort: 19325, assetCache: objects });
  t.after(async () => { try { await adapter.stop(); } catch {} });
  assert.deepEqual((await adapter.create()).assetSeed, { objects: 1, indexes: 1, bytes: content.length + index.length });
  assert.deepEqual(await readFile(join(adapter.cache, 'client/runtime/1.21.1/assets/objects', hash.slice(0, 2), hash)), content);
  assert.deepEqual(await readFile(join(adapter.cache, 'client/runtime/1.21.1/assets/indexes', `${indexHash}.json`)), index);
  await assert.rejects(readFile(join(adapter.cache, 'client/runtime/1.21.1/assets/indexes/17.json')), /ENOENT/u);
  await assert.rejects(readFile(join(adapter.cache, '.ready-windows')), /ENOENT/u);
  await adapter.stop();
  await writeFile(join(objects, hash.slice(0, 2), hash), 'corrupted');
  const broken = new McPilotRuntimeAdapter({ backendRoot, runDir: join(dir, 'bad-seed'), clientName: 'bad-seed', minecraft: '1.21.1', loader: 'fabric', java: process.execPath, wsPort: 19326, assetCache: objects });
  await assert.rejects(broken.create(), /Asset seed SHA-1 mismatch/u); await broken.stop();
});

test('transient runtime installation retries are bounded and recorded without retrying game actions', async t => {
  const { adapter, backendRoot, dir } = await fixture(t, { loader: 'neoforge', loaderVersion: '21.1.252', downloadConcurrency: 2 });
  await writeFile(join(backendRoot, 'dist/download/client/FabricRuntimeDownloader.js'), `const options={assetsDownloadConcurrency: 16,librariesDownloadConcurrency: 16};let attempts=0;export async function prepareManagedClientRuntime(variant){if(++attempts<=2)throw Object.assign(Error('temporary network outage'),{code:'ETIMEDOUT'});return{versionId:'neoforge-'+variant.neoforgeVersion}}`);
  assert.equal((await adapter.create()).runtimeVersionId, 'neoforge-21.1.252'); await adapter.stop();
  const output = await readFile(join(dir, 'run/broker-logs/stdout.log'), 'utf8');
  assert.equal(output.split('\n').filter(line => line.includes('"event":"download-retry"')).length, 2);
});

test('persistent runtime download failures stop after three attempts and remain failures', async t => {
  const { adapter, backendRoot, dir } = await fixture(t, { loader: 'neoforge', loaderVersion: '21.1.252', downloadConcurrency: 2 });
  await writeFile(join(backendRoot, 'dist/download/client/FabricRuntimeDownloader.js'), `const options={assetsDownloadConcurrency: 16,librariesDownloadConcurrency: 16};export async function prepareManagedClientRuntime(){throw Object.assign(Error('persistent network outage'),{code:'ETIMEDOUT'})}`);
  await assert.rejects(adapter.create(), /persistent network outage/u); await adapter.stop();
  const output = await readFile(join(dir, 'run/broker-logs/stdout.log'), 'utf8');
  assert.equal(output.split('\n').filter(line => line.includes('"event":"download-retry"')).length, 2);
  assert.doesNotMatch(output, /"attempt":4/u);
});

test('mc-pilot validates client names, local server and screenshot paths', async t => {
  const { adapter, dir, backendRoot, wsPort } = await fixture(t);
  assert.throws(() => new McPilotRuntimeAdapter({ backendRoot, runDir:dir, clientName:'../unsafe',minecraft:'1.21.1',loader:'fabric',java:process.execPath,wsPort }), /client name/u);
  await assert.rejects(adapter.launch('remote.example:25565'), /loopback/u);
  await assert.rejects(adapter.screenshot('../image.png'), /simple PNG/u);
});

test('helper-free client smoke removes only the known owned helper before launch', async t => {
  const { adapter } = await fixture(t); const client = await adapter.create();
  const launch = await adapter.launchWithoutHelper('127.0.0.1:25565');
  assert.equal(launch.helperEnabled, false);
  await assert.rejects(readFile(client.helperJar), /ENOENT/u);
  await adapter.stop();
});

