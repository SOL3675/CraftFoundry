import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runServerPersistence } from '../dist/adapters/test/persistence.js';
import { OwnedServer } from '../dist/adapters/runtime/server.js';

async function contract(mode = '') {
  const root = await mkdtemp(path.join(tmpdir(), 'foundry restart '));
  await writeFile(path.join(root, 'fixture.jar'), 'fixture');
  const script = path.join(root, 'server.mjs');
  await writeFile(script, `import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const count=existsSync('boots') ? Number(readFileSync('boots','utf8'))+1 : 1; writeFileSync('boots',String(count));
writeFileSync('pid-'+count,String(process.pid));
let state=existsSync('disk-state') ? readFileSync('disk-state','utf8') : '';
if(['forget','forget-diagnostic'].includes(process.argv[2]) && count===2) state='';
if(process.argv[2]==='forget-diagnostic')console.log('RESTORED old FAIL');
if(process.argv[2]==='fail-start')process.exit(1);
process.stdout.write('Done ready\\n');
let buffer=''; process.stdin.on('data',b=>{buffer+=b.toString();let index;
while((index=buffer.indexOf('\\n'))>=0){const command=buffer.slice(0,index);buffer=buffer.slice(index+1);
if(command.startsWith('seed ')){state=command.slice(5);console.log('SEEDED '+state);}
if(command.startsWith('read ') && !(process.argv[2]==='pause-restoration' && count===2)){console.log('RESTORED '+(state===command.slice(5) ? state : process.argv[2]==='forget-diagnostic' ? command.slice(5)+' FAIL' : 'FAIL'));}
if(command==='save-all flush'){console.log('Saved the game');}
if(command==='stop' && process.argv[2]!=='hang'){writeFileSync('disk-state',state);process.exit(0);}
}});`);
  const loaded = { root, config: { targets: { target: {} } }, local: { schemaVersion: 1, eulaAccepted: true, timeouts: { start: 5000, test: 10000, stop: mode === 'hang' ? 150 : 2000 } }, lock: { tools: {} } } as any;
  const runtime = { kind: 'server', capabilities: [], command: { executable: process.execPath, args: [script, mode] }, readyPattern: 'Done ready' } as any;
  const suite = { driver: 'server-persistence', persistence: { seed: [{ command: 'seed {nonce}', pattern: 'SEEDED {nonce}' }], assertions: [{ id: 'persistence.restore.custom', command: 'read {nonce}', pattern: 'RESTORED {nonce}' }] } } as any;
  const artifacts = [{ path: 'fixture.jar', sha256: createHash('sha256').update('fixture').digest('hex'), kind: 'distribution', side: 'both' }] as any;
  return { root, loaded, runtime, suite, artifacts, directory: path.join(root, 'game') };
}
test('persistence driver requires two real process lifetimes, disk restoration and distinct retained logs', async () => {
  const c = await contract();
  try {
    const result = await runServerPersistence(c.loaded, 'target', c.runtime, c.suite, c.artifacts, c.root, c.directory);
    assert.ok(result.cases.every(c => c.status === 'passed'), JSON.stringify(result.cases));
    assert.equal(await readFile(path.join(c.directory, 'boots'), 'utf8'), '2');
    const pids = await Promise.all([1, 2].map(i => readFile(path.join(c.directory, 'pid-' + i), 'utf8')));
    assert.notEqual(pids[0], pids[1]);
    for (const pid of pids) assert.throws(() => process.kill(Number(pid), 0), /ESRCH/);
    assert.ok(result.logs.some(p => p.includes('launch-1')) && result.logs.some(p => p.includes('launch-2')));
    for (const file of [...result.logs, ...result.evidence]) assert.ok(!file.includes('\\'), 'Run evidence paths must use portable forward slashes');
    const evidence = JSON.parse(await readFile(path.join(c.directory, 'persistence.json'), 'utf8'));
    assert.equal(evidence.transcript.filter((e: any) => e.command.startsWith('seed')).length, 1);
    assert.equal(evidence.transcript.at(-1).launch, 2);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});
test('lost restoration fails and skips final success; cleanup stops the second process', async () => {
  const c = await contract('forget'); c.loaded.local.timeouts.test = 600;
  try {
    const result = await runServerPersistence(c.loaded, 'target', c.runtime, c.suite, c.artifacts, c.root, c.directory);
    assert.equal(result.cases.find(c => c.id === 'persistence.restore.custom')?.status, 'failed');
    for (const id of ['persistence.seed','persistence.saved','persistence.stopped','persistence.restarted']) assert.equal(result.cases.find(c=>c.id===id)?.status,'passed',id);
    const evidence = JSON.parse(await readFile(path.join(c.directory,'persistence.json'),'utf8'));
    assert.equal(evidence.transcript.filter((e:any)=>e.command.startsWith('seed')).length,1);
    assert.notEqual(await readFile(path.join(c.directory,'pid-1'),'utf8'),await readFile(path.join(c.directory,'pid-2'),'utf8'));
    assert.equal(result.cases.find(c => c.id === 'persistence.final-stop')?.status, 'skipped');
    const pid = Number(await readFile(path.join(c.directory, 'pid-2'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});
test('explicit failure response ends restoration promptly and retains the nonce-specific diagnostic', async () => {
  const c = await contract('forget-diagnostic'); c.loaded.local.timeouts.test = 60_000;
  c.suite.persistence.assertions[0].failurePattern = 'RESTORED {nonce} FAIL';
  try {
    const started = Date.now();
    const result = await runServerPersistence(c.loaded,'target',c.runtime,c.suite,c.artifacts,c.root,c.directory);
    assert.ok(Date.now()-started < 5000, 'An explicit failure must not wait for the 60 second deadline');
    assert.equal(result.cases.find(c=>c.id==='persistence.seed')?.status,'passed');
    const failed = result.cases.find(c=>c.id==='persistence.restore.custom');
    assert.equal(failed?.status,'failed'); assert.match(failed!.message!,/Server probe reported failure: RESTORED [0-9a-f-]+ FAIL/);
    const evidence = JSON.parse(await readFile(path.join(c.directory,'persistence.json'),'utf8'));
    assert.match(evidence.transcript.at(-1).error,new RegExp(evidence.nonce+' FAIL'));
    assert.throws(()=>process.kill(Number(readFileSync(path.join(c.directory,'pid-2'),'utf8')),0),/ESRCH/);
  } finally { await rm(c.root,{recursive:true,force:true}); }
});
test('shutdown timeout cannot restart or pass, and kills the owned process', async () => {
  const c = await contract('hang');
  try {
    const result = await runServerPersistence(c.loaded, 'target', c.runtime, c.suite, c.artifacts, c.root, c.directory);
    assert.equal(result.cases.find(c => c.id === 'persistence.stopped')?.status, 'infrastructure-error');
    assert.equal(await readFile(path.join(c.directory, 'boots'), 'utf8'), '1');
    const pid = Number(await readFile(path.join(c.directory, 'pid-1'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});
test('startup failure cannot save or restart and retains its failed launch', async () => {
  const c = await contract('fail-start');
  try {
    const result = await runServerPersistence(c.loaded,'target',c.runtime,c.suite,c.artifacts,c.root,c.directory);
    assert.equal(result.cases[0]?.status,'infrastructure-error');
    assert.ok(result.cases.slice(1).every(c=>c.status==='skipped'));
    assert.equal(await readFile(path.join(c.directory,'boots'),'utf8'),'1');
    assert.throws(()=>process.kill(Number(readFileSync(path.join(c.directory,'pid-1'),'utf8')),0),/ESRCH/);
    assert.ok(result.logs.some(p=>p.includes('launch-1')));
  } finally { await rm(c.root,{recursive:true,force:true}); }
});
test('cancellation during restoration disposes the second process without passing restoration', async () => {
  const c = await contract('pause-restoration'), controller = new AbortController();
  try {
    const pending = runServerPersistence(c.loaded,'target',c.runtime,c.suite,c.artifacts,c.root,c.directory,controller.signal);
    const deadline = Date.now()+5000;
    while(Date.now()<deadline) {
      try { await readFile(path.join(c.directory,'pid-2')); break; } catch(error:any) { if(error.code!=='ENOENT') throw error; }
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    controller.abort();const result=await pending;
    assert.equal(await readFile(path.join(c.directory,'boots'),'utf8'),'2');
    assert.equal(result.cases.find(c=>c.id==='persistence.restore.custom')?.status,'failed');
    assert.equal(result.cases.find(c=>c.id==='persistence.final-stop')?.status,'skipped');
    for(const launch of [1,2]) assert.throws(()=>process.kill(Number(readFileSync(path.join(c.directory,'pid-'+launch),'utf8')),0),/ESRCH/);
  } finally { controller.abort();await rm(c.root,{recursive:true,force:true}); }
});
test('an existing world is never prepared or overwritten and an unstarted session cannot restart', async () => {
  const c = await contract();
  try {
    await mkdir(path.join(c.directory, 'world'), { recursive: true });
    await writeFile(path.join(c.directory, 'world', 'original'), 'user world');
    const server = new OwnedServer(c.loaded, 'target', c.runtime, c.directory, path.join(c.root, 'logs'));
    await assert.rejects(server.prepare(c.artifacts, c.root), /empty disposable session/);
    await assert.rejects(server.restart(), /clean process exit/);
    const result = await runServerPersistence(c.loaded,'target',c.runtime,c.suite,c.artifacts,c.root,c.directory);
    assert.equal(result.cases[0]?.status,'infrastructure-error'); assert.deepEqual(result.evidence,[]);
    await assert.rejects(readFile(path.join(c.directory,'persistence.json')),{code:'ENOENT'});
    assert.equal(await readFile(path.join(c.directory, 'world', 'original'), 'utf8'), 'user world');
  } finally { await rm(c.root, { recursive: true, force: true }); }
});
import {readFileSync} from 'node:fs';
