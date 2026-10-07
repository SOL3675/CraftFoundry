import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureForSurvival } from '../../scripts/lib/atlas-capture.mjs';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
for (const mode of ['fresh', 'replay', 'changed-config', 'changed-before-expectation']) test(`automatic acquisition capture ${mode} binds the current built Run and cleans its process`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'foundry fresh acquisition '));
  try {
    const run = path.join(root, 'run'), session = path.join(run, 'session'), artifactRoot = path.join(run, 'artifacts', 'fabric');
    await mkdir(artifactRoot,{recursive:true}); await mkdir(session,{recursive:true});
    await writeFile(path.join(artifactRoot,'mod.jar'),'current built mod');
    const record = JSON.stringify({schemaVersion:1,target:'fabric',artifacts:[{path:'mod.jar',sha256:sha('current built mod'),size:17,kind:'distribution',side:'both',originalPath:'mod.jar'}]});
    await writeFile(path.join(artifactRoot,`artifacts-${sha(record)}.json`),record);
    const script = path.join(root,'server.mjs');
    await writeFile(script, `import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const identityHash=value=>digest(canonical(value));
const captureInputs=()=>{const result={};const visit=file=>{if(!existsSync(file))return;if(statSync(file).isDirectory())for(const child of readdirSync(file))visit(file+'/'+child);else result[file]=digest(readFileSync(file));};for(const root of ['mods','config','defaultconfigs','kubejs','scripts','world/serverconfig','world/datapacks','server.properties'])visit(root);return result;};
const configurationHash=inputs=>identityHash(Object.fromEntries(Object.entries(inputs).filter(([key])=>key==='server.properties'||['config/','defaultconfigs/','world/serverconfig/'].some(root=>key.startsWith(root)))));
const session='11111111-1111-1111-1111-111111111111';mkdirSync('config',{recursive:true});writeFileSync('config/mod.json','first');
const startupInputsHash=identityHash(captureInputs());const startupConfigurationHash=configurationHash(captureInputs());console.log('Done ready');let buffer='';process.stdin.on('data',async bytes=>{buffer+=bytes;let index;while((index=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
if(line==='craftatlas status'){if(${JSON.stringify(mode)}==='changed-before-expectation')writeFileSync('config/mod.json','after-boot-before-expectation');console.log('CRAFTATLAS STATUS session='+session+' generation=1 status=ready');}
if(line.startsWith('craftatlas dump ')) {const label=line.slice(16);if(${JSON.stringify(mode)}==='changed-config')writeFileSync('config/mod.json','after-expectation');
const launch=JSON.parse(readFileSync('.craftatlas-launch.json','utf8'));const inputs=captureInputs();
const loadedJars=readdirSync('mods').map(name=>({name,sha256:createHash('sha256').update(readFileSync('mods/'+name)).digest('hex')}));
const snapshot={schemaVersion:1,minecraft:'1.21.1',loader:'fabric',loaderVersion:'0.16.14',session,generation:1,runtimeIdentity:{schemaVersion:1,status:'complete',launchNonce:${JSON.stringify(mode)}==='replay'?'00000000-0000-0000-0000-000000000000':launch.launchNonce,requestId:label,session,generation:1,inputs,loadedJars,startupJarsHash:identityHash(loadedJars),jvmProperties:{},startupPropertiesHash:identityHash({}),startupConfigurationHash,startupInputsHash,errors:[]}};
mkdirSync('craftatlas/'+label,{recursive:true});writeFileSync('craftatlas/'+label+'/snapshot.json',JSON.stringify(snapshot));console.log('CRAFTATLAS COMPLETE label='+label+' generation=1 path=craftatlas/'+label);}
if(line==='stop')process.exit(0);}});`);
    await writeFile(path.join(root,'harness.config.json'),JSON.stringify({schemaVersion:1,projectId:'capture-contract',builds:{main:{root:'.',adapter:'gradle'}},targets:{fabric:{minecraft:'1.21.1',loader:'fabric',loaderVersion:'0.16.14',build:'main',tasks:{},artifactManifest:'manifest.json',requiredSuites:[]}},suites:{},runtimes:{server:{kind:'server',capabilities:['dedicated-server'],command:{executable:process.execPath,args:[script]},readyPattern:'Done ready'}}}));
    await writeFile(path.join(root,'harness.local.json'),JSON.stringify({schemaVersion:1,eulaAccepted:true,timeouts:{start:3000,test:5000,stop:2000}}));
    const atlas = {captureIdentityContractVersion:1,readSnapshot:(file:string)=>JSON.parse(requireFile(file))};
    // Synchronous read represents the collector consumer boundary, independent of this process's expected manifest.
    function requireFile(file:string) { return readFileSync(path.join(file,'snapshot.json'),'utf8'); }
    const result = await captureForSurvival(atlas as any,'server',root,run,session,'fabric');
    assert.equal(result.verdict.status,mode==='fresh'?'passed':'failed');
    const saved = JSON.parse(await readFile(path.join(session,'capture-expectation.json'),'utf8'));
    assert.equal(saved.artifacts[0].sha256,sha('current built mod')); assert.notEqual(saved.launchNonce,'00000000-0000-0000-0000-000000000000');
    assert.equal(JSON.parse(await readFile(path.join(session,'capture-lifecycle.json'),'utf8')).cleanStop,true);
    assert.ok(await readFile(path.join(session,'capture-process-logs/launch-1/stdout.log'),'utf8'));
  } finally { await rm(root,{recursive:true,force:true}); }
});
import {readFileSync} from 'node:fs';
