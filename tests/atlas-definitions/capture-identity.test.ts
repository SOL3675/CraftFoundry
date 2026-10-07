import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadAtlas} from '../../scripts/lib/atlas-survival.mjs';
import {loadConfig} from '../../dist/core/config.js';
import {executeRun} from '../../dist/core/runner.js';
import {collectFixtureEvidence} from '../../.github/scripts/collect-fixture-evidence.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.CRAFTATLAS_DEFINITION_SOURCE ?? join(root,'projects/craft-atlas'));
const atlas=await loadAtlas(root,source);

test('current capture API, actual process suite and raw publication preserve fresh success, replay failure and unknown semantics', {skip:atlas.captureIdentityContractVersion!==1?'Pinned legacy API has no capture identity v1; run with a clean v1 --atlas-source candidate':false}, async t=>{
  const project=mkdtempSync(join(tmpdir(),'Foundry current capture '));t.after(()=>rmSync(project,{recursive:true,force:true}));
  mkdirSync(join(project,'build/libs'),{recursive:true});writeFileSync(join(project,'build/libs/mod.jar'),'current built distribution');writeFileSync(join(project,'build/libs/collector.jar'),'recorded collector dependency');
  writeFileSync(join(project,'gradlew'),'#!/bin/sh\nexit 0\n');chmodSync(join(project,'gradlew'),0o755);writeFileSync(join(project,'gradlew.bat'),'@echo off\r\nexit /b 0\r\n');
  writeFileSync(join(project,'manifest.json'),JSON.stringify({schemaVersion:1,target:'neoforge',minecraft:'1.21.1',loader:'neoforge',loaderVersion:'21.1.252',artifacts:[{path:'build/libs/mod.jar',kind:'distribution',side:'both'},{path:'build/libs/collector.jar',kind:'runtime-dependency',side:'both'}]}));
  const snapshot=JSON.parse(readFileSync(join(root,'tests/atlas/fixtures/snapshot.json'),'utf8'));
  writeFileSync(join(project,'server.mjs'),`import {readFileSync,writeFileSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';
import {writeSnapshot} from ${JSON.stringify(pathToFileURL(join(source,'packages/core/src/snapshot.ts')).href)};
const digest=v=>createHash('sha256').update(v).digest('hex');const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);const hash=v=>digest(canonical(v));
const snapshot=${JSON.stringify(snapshot)};snapshot.session='11111111-1111-1111-1111-111111111111';snapshot.generation=1;
const launch=JSON.parse(readFileSync('.craftatlas-launch.json','utf8'));const inputs=Object.fromEntries(['server.properties',...readdirSync('mods').map(name=>'mods/'+name)].map(name=>[name,digest(readFileSync(name))]));const loadedJars=readdirSync('mods').map(name=>({name,sha256:inputs['mods/'+name]}));writeFileSync('process.pid',String(process.pid));
console.log('Done ready');let buffer='';process.stdin.on('data',b=>{buffer+=b;let end;while((end=buffer.indexOf('\\n'))>=0){const command=buffer.slice(0,end);buffer=buffer.slice(end+1);if(command==='craftatlas status')console.log('CRAFTATLAS STATUS session='+snapshot.session+' generation=1 status=ready');
if(command.startsWith('craftatlas dump ')){const label=command.slice(16);snapshot.runtimeIdentity={schemaVersion:1,status:'complete',launchNonce:process.argv[2]==='replay'?'00000000-0000-0000-0000-000000000000':launch.launchNonce,requestId:label,session:snapshot.session,generation:1,inputs,loadedJars,startupJarsHash:hash(loadedJars),startupInputsHash:hash(inputs),startupConfigurationHash:hash({'server.properties':inputs['server.properties']}),startupPropertiesHash:hash({}),jvmProperties:{},errors:[]};writeSnapshot('craftatlas/'+label,snapshot);console.log('CRAFTATLAS COMPLETE label='+label+' generation=1 path=craftatlas/'+label);}if(command==='stop')process.exit(0);}});`);
  const config=JSON.parse(readFileSync(join(root,'tests/atlas/fixtures/suite.json'),'utf8'));config.captureRuntime='capture';config.snapshot='intentionally-absent-old-dump.json';
  const harness={schemaVersion:1,projectId:'fresh-capture-contract',builds:{main:{root:'.',adapter:'gradle'}},targets:{neoforge:{minecraft:'1.21.1',loader:'neoforge',loaderVersion:'21.1.252',build:'main',tasks:{build:['assemble']},artifactManifest:'manifest.json',requiredSuites:['acquisition']}},suites:{acquisition:{driver:'process',runtime:'analysis',results:'results.json',expectedTests:config.cases.map((c:any)=>c.id)}},runtimes:{analysis:{kind:'server',capabilities:[],command:{executable:process.execPath,args:[join(root,'scripts/atlas-survival.mjs'),'--config','{projectRoot}/survival.json','--results','{sessionRoot}/results.json','--atlas-source',source,'--harness']}},capture:{kind:'server',capabilities:['dedicated-server'],command:{executable:process.execPath,args:[join(project,'server.mjs'),'fresh']},readyPattern:'Done ready'}}};
  writeFileSync(join(project,'harness.local.json'),JSON.stringify({schemaVersion:1,eulaAccepted:true,timeouts:{start:3000,test:20000,stop:2000}}));
  for(const mode of ['fresh','replay','unknown']){
    harness.runtimes.capture.command.args[1]=mode;const current=structuredClone(config);if(mode==='unknown')current.providers[0].availability='unknown';
    writeFileSync(join(project,'harness.config.json'),JSON.stringify(harness));writeFileSync(join(project,'survival.json'),JSON.stringify(current));
    const run=await executeRun(await loadConfig(project),{command:'test',targets:['neoforge']});const suite=run.targets[0]!.suites[0]!;
    assert.equal(run.status,mode==='fresh'?'passed':'failed',JSON.stringify(suite));assert.ok(suite.cases.every(c=>c.status===(mode==='fresh'?'passed':mode==='replay'?'failed':'unsupported')));
    const runRoot=join(project,'.harness/runs',run.id),session=join(runRoot,'sessions/neoforge/acquisition');const evidence=JSON.parse(readFileSync(join(session,'results.json.evidence.json'),'utf8'));
    assert.equal(evidence.captureIdentity.status,mode==='replay'?'failed':'passed');assert.equal(evidence.captureIdentity.expected.artifacts.length,2);
    const pid=Number(readFileSync(join(session,'capture-game/process.pid'),'utf8'));assert.throws(()=>process.kill(pid,0),/ESRCH/);
    assert.ok(evidence.captureEvidence.files.some((f:any)=>f.file.endsWith('recipes.jsonl')));assert.ok(suite.evidence!.some(f=>f.endsWith('recipes.jsonl')));
    await collectFixtureEvidence(project);for(const f of evidence.captureEvidence.files)assert.deepEqual(readFileSync(join(project,'.harness/ci/evidence/runs',run.id,'sessions/neoforge/acquisition',f.file)),readFileSync(join(session,f.file)));
  }
});
