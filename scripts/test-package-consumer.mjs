import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, chmodSync, copyFileSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!['--package', '--previous'].includes(key) || !value || options[key]) throw new Error('Usage: npm run test:consumer -- --package <tarball> [--previous <prior-tarball>]');
  options[key] = resolve(value);
}
if (!options['--package']) throw new Error('--package is required');
const directory = mkdtempSync(join(tmpdir(), 'Foundry packed consumer 日本語 '));
const npm = (...args) => {
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: directory, encoding: 'utf8' })
    : spawnSync('npm', args, { cwd: directory, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
};
try {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'foundry-packed-consumer', private: true, type: 'module' }));
  const packageRoot = join(directory, 'node_modules/craft-foundry');
  const destination = join(directory, '.agents/skills');
  const cli = (...args) => {
    const result = spawnSync(process.execPath, [join(packageRoot, 'dist/cli/main.js'), ...args], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const install = () => cli('skills', 'install', '--destination', destination, '--json');
  const metadata = () => JSON.parse(readFileSync(join(destination, '.mch-skills.json'), 'utf8'));
  let previous;
  if (options['--previous']) {
    npm('install', '--save-dev', '--save-exact', options['--previous'], '--ignore-scripts');
    install(); previous = metadata();
    writeFileSync(join(destination, 'project-setup/SKILL.md'), 'Consumer customization must survive the actual package upgrade\n');
  }
  npm('install', '--save-dev', '--save-exact', options['--package'], '--ignore-scripts');
  const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
  assert.equal(version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  const skillNames = ['development-loop', 'minecraft-development-basics', 'porting', 'project-setup', 'troubleshooting'];
  const freshDestination = join(directory, 'fresh-skills');
  const fresh = cli('skills', 'install', '--destination', freshDestination, '--json');
  assert.deepEqual(fresh.installed.sort(), skillNames.map(name => name + '/SKILL.md'));
  assert.deepEqual(fresh.updated, []); assert.deepEqual(fresh.preserved, []);
  const freshProvenance = JSON.parse(readFileSync(join(freshDestination, '.mch-skills.json'), 'utf8'));
  for (const name of skillNames) {
    const file = name + '/SKILL.md', bytes = readFileSync(join(freshDestination, file));
    assert.deepEqual(bytes, readFileSync(join(packageRoot, 'skills', file)));
    assert.equal(freshProvenance.files[file].version, version);
    assert.equal(freshProvenance.files[file].sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.deepEqual(cli('skills', 'install', '--destination', freshDestination, '--json'), { schemaVersion: 1, version, installed: [], updated: [], preserved: [] });
  // Model an earlier four-Skill installation with this package's real installer.
  // Bundle overrides remain isolated here; no consumer checkout is modified.
  if (!previous) {
    const { installSkills } = await import(pathToFileURL(join(packageRoot, 'dist/core/skills.js')).href);
    const oldBundle = join(directory, 'previous-bundle');
    mkdirSync(oldBundle);
    for (const name of ['project-setup', 'development-loop', 'porting', 'troubleshooting']) cpSync(join(packageRoot, 'skills', name), join(oldBundle, name), { recursive: true });
    await installSkills(destination, { sourceRoot: oldBundle, version: '0.1.11' });
    previous = metadata();
    writeFileSync(join(destination, 'project-setup/SKILL.md'), 'Consumer customization must survive the actual package upgrade\n');
  }
  const updated = install(), provenance = metadata();
  assert.ok(updated.installed.includes('minecraft-development-basics/SKILL.md'));
  assert.equal(provenance.version, version);
  if (previous) {
    assert.equal(readFileSync(join(destination, 'project-setup/SKILL.md'), 'utf8'), 'Consumer customization must survive the actual package upgrade\n');
    assert.deepEqual(provenance.files['project-setup/SKILL.md'], previous.files['project-setup/SKILL.md']);
  }
  for (const name of ['development-loop', 'minecraft-development-basics', 'porting', 'troubleshooting']) {
    const file = name + '/SKILL.md', bytes = readFileSync(join(destination, file));
    assert.deepEqual(bytes, readFileSync(join(packageRoot, 'skills', file)));
    assert.equal(provenance.files[file].version, version);
    assert.equal(provenance.files[file].sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.ok(existsSync(join(packageRoot, 'templates/validation/README.md')));
  assert.ok(existsSync(join(packageRoot, 'docs/development.md')));
  const setupConfig = JSON.parse(readFileSync(join(packageRoot, 'templates/existing-project/harness.config.json'), 'utf8'));
  assert.deepEqual(setupConfig.targets['fabric-1.21.1'].requiredSuites, ['unit']);
  assert.equal(setupConfig.suites['server-persistence'].driver, 'unsupported');
  assert.equal(metadata().version, version);
  const repeated = install();
  assert.deepEqual(repeated.installed, []); assert.deepEqual(repeated.updated, []);
  assert.deepEqual(repeated.preserved, previous ? ['project-setup/SKILL.md'] : []);
  const template = readFileSync(join(packageRoot, 'templates/acquisition/README.md'), 'utf8');
  assert.match(template, /yourmod:recipes\/press.json/);
  assert.match(template, /never establish exhaustive absence/);
  assert.match(template, /Forge fluid runtime behavior remains unverified/);
  const definitions = JSON.parse(readFileSync(join(packageRoot, 'templates/acquisition/definitions.json'), 'utf8'));
  assert.deepEqual([definitions.targets.loader, definitions.targets.minecraft], ['neoforge', '1.21.1']);
  assert.ok(!existsSync(join(packageRoot, 'projects')) && !existsSync(join(packageRoot, 'scripts/atlas-survival.mjs')));
  assert.ok(!existsSync(join(packageRoot, '.harness')) && !existsSync(join(packageRoot, 'harness.local.json')));
  // Resolve only the installed package's explicit exports, with no repository source imports.
  execFileSync(process.execPath, ['--input-type=module', '-e', "for (const part of ['core/config','core/capture-identity','core/cache','core/tools','core/types','core/storage','adapters/runtime/server','adapters/runtime/mc-pilot']) await import('craft-foundry/' + part)"], { cwd: directory, encoding: 'utf8' });
  writeFileSync(join(directory, 'case-contract.ts'), `import type { CaseResult } from 'craft-foundry/core/types';
const result: CaseResult = {id:'survival.item',status:'unsupported',message:'Human summary',detail:{file:'results.json.evidence.json',pointer:'/details/0'},diagnostics:{schemaVersion:1,counts:{incomplete:1,unknown:0,stopReasons:0}}};
export {result};`);
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), 'case-contract.ts'], { cwd: directory, encoding: 'utf8' });
  const listed = cli('targets', '--project', packageRoot, '--json');
  assert.ok(JSON.stringify(listed).includes('forge-1.20.1') && JSON.stringify(listed).includes('fabric-1.20.1'));
  const packagedConfig = JSON.parse(readFileSync(join(packageRoot,'harness.config.json'),'utf8'));
  for (const target of Object.values(packagedConfig.targets)) assert.ok(target.requiredSuites.includes('server-persistence'));
  assert.equal(packagedConfig.suites['server-persistence'].driver,'server-persistence');
  assert.ok(existsSync(join(packageRoot,'dist/adapters/test/persistence.js')));
  // The repository-only Atlas producer is not shipped. Its optional result metadata
  // must still survive the installed process driver, report CLI and CI template.
  mkdirSync(join(directory, 'build/libs'), { recursive: true });
  writeFileSync(join(directory, 'build/libs/fixture.jar'), 'Offline contract artifact');
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, target: 'fabric', minecraft: '1.21.1', loader: 'fabric', artifacts: [{ path: 'build/libs/fixture.jar', kind: 'distribution', side: 'both' }] }));
  writeFileSync(join(directory, 'gradlew.bat'), '@echo off\r\nexit /b 0\r\n');
  writeFileSync(join(directory, 'gradlew'), '#!/bin/sh\nexit 0\n'); chmodSync(join(directory, 'gradlew'), 0o755);
  writeFileSync(join(directory, 'produce.mjs'), `import {writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const raw='{"raw":"runtime provenance 日本語"}\\n';writeFileSync('recipes.jsonl',raw);
if (!process.argv.includes('--missing-detail')) writeFileSync('results.json.evidence.json', JSON.stringify({schemaVersion:2,diagnosticContractVersion:1,captureEvidence:{schemaVersion:1,files:[{file:'recipes.jsonl',sha256:createHash('sha256').update(raw).digest('hex')}]},incomplete:['Complete detail 日本語🌋 <&> '.repeat(100000)],details:[{incompleteRef:'#/incomplete',analysis:{unknown:[],stopReasons:[]}}]}));
writeFileSync('results.json', JSON.stringify({schemaVersion:1,cases:[{id:'survival.item',status:process.argv.includes('--missing-detail')?'passed':'unsupported',message:'Unknown acquisition; Next: review the evidence and capture',diagnostics:{schemaVersion:1,counts:{incomplete:1,unknown:0,stopReasons:0}},detail:{file:'results.json.evidence.json',pointer:'/details/0'}}]}));`);
  writeFileSync(join(directory, 'harness.config.json'), JSON.stringify({ schemaVersion: 1, projectId: 'packed-diagnostics',
    builds: { main: { root: '.', adapter: 'gradle' } },
    targets: { fabric: { minecraft: '1.21.1', loader: 'fabric', build: 'main', tasks: { build: ['assemble'] }, artifactManifest: 'manifest.json', requiredSuites: ['survival'] } },
    suites: { survival: { driver: 'process', runtime: 'analysis', results: 'results.json', expectedTests: ['survival.item'] } },
    runtimes: { analysis: { kind: 'server', capabilities: [], command: { executable: process.execPath, args: ['{projectRoot}/produce.mjs'] } } },
  }));
  // The installed CLI must preserve historical caches and evidence even when a
  // consumer opts future managed sessions into automatic dependency cleanup.
  writeFileSync(join(directory, 'harness.local.json'), JSON.stringify({ schemaVersion: 1, storage: { managedCaches: true, sharedAssets: true, cleanup: 'after-suite' } }));
  const historicalCache = join(directory, '.harness/c/historical/mct-cache/client/libraries/old.jar');
  mkdirSync(join(historicalCache, '..'), { recursive: true }); writeFileSync(historicalCache, 'Unowned historical cache');
  const storageInventory = cli('storage'), storagePreview = cli('storage', '--clean');
  assert.equal(storageInventory.sizeKind, 'logical'); assert.equal(storageInventory.reclaimableBytes, 0);
  assert.equal(storagePreview.apply, false); assert.equal(storagePreview.deletedBytes, 0);
  assert.deepEqual(storagePreview.entries, storageInventory.entries);
  const historicalEntry = storagePreview.entries.find(item => item.path === '.harness/c/historical/mct-cache/client/libraries/old.jar');
  assert.equal(historicalEntry?.disposition, 'retain'); assert.equal(historicalEntry.reason, 'unmarked-or-retained-data');
  assert.ok(!existsSync(join(directory, '.harness/storage')), 'inventory and default cleanup preview stay read-only');
  const invalidStorageFlags = spawnSync(process.execPath, [join(packageRoot, 'dist/cli/main.js'), 'storage', '--apply', '--json'], { cwd: directory, encoding: 'utf8' });
  assert.equal(invalidStorageFlags.status, 2); assert.match(JSON.parse(invalidStorageFlags.stdout).error, /require --clean/);
  const tested = spawnSync(process.execPath, [join(packageRoot, 'dist/cli/main.js'), 'test', '--target', 'fabric', '--json'], { cwd: directory, encoding: 'utf8' });
  assert.equal(tested.status, 1, tested.stderr); const run = JSON.parse(tested.stdout);
  const caseResult = run.targets[0].suites[0].cases[0];
  assert.equal(caseResult.status, 'unsupported');
  assert.ok(tested.stdout.length < 10000);
  assert.deepEqual(cli('report', '--run', run.id), run);
  const runRoot = join(directory, '.harness/runs', run.id), detailFile = caseResult.detail.file;
  assert.ok(run.targets[0].suites[0].evidence.includes(detailFile));
  assert.ok(readFileSync(join(runRoot, 'junit.xml'), 'utf8').includes(detailFile + '#/details/0'));
  const bytes = readFileSync(join(runRoot, detailFile));
  assert.ok(bytes.length > 2000000);
  const managed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict'; import {randomUUID} from 'node:crypto'; import {mkdir,readFile,writeFile} from 'node:fs/promises'; import {join} from 'node:path';
import {createStorageReservation,acquireStorageLease,createStorageEvidenceSeal,attachStorageEvidence,releaseStorageLease,closeStorageReservation,cleanupStorage} from 'craft-foundry/core/storage';
const root=process.cwd(),cache=join(root,'.harness/c',randomUUID(),'mct-cache/client');
const runRoot=process.argv[1],report=JSON.parse(await readFile(join(runRoot,'report.json'),'utf8'));
delete report.finishedAt; report.status='infrastructure-error'; await writeFile(join(runRoot,'report.json'),JSON.stringify(report));
const handle=await createStorageReservation(root,cache),first=await acquireStorageLease(root,handle); await mkdir(join(cache,'libraries'),{recursive:true});
await writeFile(join(cache,'libraries/dependency.jar'),Buffer.alloc(4096,7));
const suite=report.targets[0].suites[0],files=[...suite.logs,...suite.evidence];
const seal=await createStorageEvidenceSeal(root,runRoot,{scope:{target:'fabric',suite:'survival',phase:'first'},files});
await attachStorageEvidence(root,runRoot,[seal]);
await releaseStorageLease(root,first,{stopped:true,evidenceRoot:runRoot,seal});
assert.equal((await cleanupStorage(root,{apply:true,unitIds:[handle.id]})).deletedBytes,0);
const second=await acquireStorageLease(root,handle); await assert.rejects(closeStorageReservation(root,handle));
const next=await createStorageEvidenceSeal(root,runRoot,{scope:{target:'fabric',suite:'survival',phase:'second'},files});
await attachStorageEvidence(root,runRoot,[next]);
await releaseStorageLease(root,second,{stopped:true,evidenceRoot:runRoot,seal:next});
await closeStorageReservation(root,handle);
Object.assign(report,JSON.parse(await readFile(join(runRoot,'report.json'),'utf8')));
console.log(JSON.stringify({id:handle.id,cache,report}));`, runRoot], { cwd: directory, encoding: 'utf8' }));
  delete run.finishedAt; Object.assign(run, managed.report);
  const managedPreview = cli('storage', '--clean', '--unit', managed.id);
  assert.equal(managedPreview.reclaimableBytes, 4096); assert.equal(managedPreview.deletedBytes, 0);
  assert.ok(existsSync(join(managed.cache, 'libraries/dependency.jar')));
  const storageApplied = cli('storage', '--clean', '--unit', managed.id, '--apply');
  assert.equal(storageApplied.apply, true); assert.equal(storageApplied.deletedBytes, 4096); assert.deepEqual(storageApplied.errors, []);
  assert.ok(!existsSync(join(managed.cache, 'libraries/dependency.jar')));
  const storageAudit = JSON.parse(readFileSync(join(directory, storageApplied.auditPath), 'utf8'));
  assert.equal(storageAudit.complete, true); assert.equal(storageAudit.deletedBytes, 4096);
  const repeatedCleanup = cli('storage', '--clean', '--unit', managed.id, '--apply');
  assert.equal(repeatedCleanup.deletedBytes, 0); assert.deepEqual(repeatedCleanup.errors, []);
  assert.equal(readFileSync(historicalCache, 'utf8'), 'Unowned historical cache');
  assert.equal(cli('report', '--run', run.id).finishedAt, undefined, 'eligible unit is reclaimed before the Run completes');
  run.finishedAt = new Date().toISOString(); run.status = 'failed';
  writeFileSync(join(runRoot, 'report.json'), JSON.stringify(run));
  assert.deepEqual(cli('report', '--run', run.id), run);
  assert.deepEqual(readFileSync(join(runRoot, detailFile)), bytes);
  // Install the unmodified CI template in its documented .github/scripts layout.
  const collector = join(packageRoot, '.github/scripts/collect-fixture-evidence.mjs');
  mkdirSync(join(packageRoot, '.github/scripts'), { recursive: true });
  copyFileSync(join(packageRoot, 'templates/ci/scripts/collect-fixture-evidence.mjs'), collector);
  const collect = spawnSync(process.execPath, ['--input-type=module', '-e', "import {pathToFileURL} from 'node:url'; const {collectFixtureEvidence} = await import(pathToFileURL(process.argv[1]).href); await collectFixtureEvidence(process.argv[2]);", collector, directory], { cwd: directory, encoding: 'utf8' });
  assert.equal(collect.status, 0, collect.stderr);
  assert.deepEqual(readFileSync(join(directory, '.harness/ci/evidence/runs', run.id, detailFile)), bytes);
  const relocated = join(directory, 'relocated-artifact'), relocatedRun = join(relocated, '.harness/runs', run.id);
  cpSync(join(directory, '.harness/ci/evidence/runs', run.id), relocatedRun, { recursive: true });
  rmSync(runRoot, { recursive: true, force: true });
  assert.deepEqual(cli('report', '--project', relocated, '--run', run.id), run);
  assert.deepEqual(readFileSync(join(relocatedRun, detailFile)), bytes);
  const rawFile = join(relocatedRun,'sessions/fabric/survival/recipes.jsonl'), rawBytes = readFileSync(rawFile);
  assert.deepEqual(rawBytes,readFileSync(join(directory,'.harness/ci/evidence/runs',run.id,'sessions/fabric/survival/recipes.jsonl')));
  writeFileSync(rawFile,'tampered');
  const tamperedReport = spawnSync(process.execPath,[join(packageRoot,'dist/cli/main.js'),'report','--project',relocated,'--run',run.id,'--json'],{cwd:directory,encoding:'utf8'});
  assert.equal(tamperedReport.status,2,tamperedReport.stderr);
  rmSync(rawFile);
  const missingRaw = spawnSync(process.execPath,['--input-type=module','-e',"import {pathToFileURL} from 'node:url'; const {collectFixtureEvidence} = await import(pathToFileURL(process.argv[1]).href); await collectFixtureEvidence(process.argv[2]);",collector,relocated],{cwd:directory,encoding:'utf8'});
  assert.notEqual(missingRaw.status,0,'CI must reject missing checksummed raw capture');writeFileSync(rawFile,rawBytes);
  rmSync(join(relocatedRun, detailFile));
  const missingReport = spawnSync(process.execPath, [join(packageRoot, 'dist/cli/main.js'), 'report', '--project', relocated, '--run', run.id, '--json'], { cwd: directory, encoding: 'utf8' });
  assert.equal(missingReport.status, 2, missingReport.stderr);
  const missingCollection = spawnSync(process.execPath, ['--input-type=module', '-e', "import {pathToFileURL} from 'node:url'; const {collectFixtureEvidence} = await import(pathToFileURL(process.argv[1]).href); await collectFixtureEvidence(process.argv[2]);", collector, relocated], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(missingCollection.status, 0, 'CI must report missing declared detail evidence');
  const configFile = join(directory, 'harness.config.json'), config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.runtimes.analysis.command.args.push('--missing-detail'); writeFileSync(configFile, JSON.stringify(config));
  const missingRun = spawnSync(process.execPath, [join(packageRoot, 'dist/cli/main.js'), 'test', '--target', 'fabric', '--json'], { cwd: directory, encoding: 'utf8' });
  assert.equal(missingRun.status, 2, missingRun.stderr);
  assert.equal(JSON.parse(missingRun.stdout).targets[0].suites[0].status, 'infrastructure-error');
  assert.equal(JSON.parse(missingRun.stdout).targets[0].suites[0].detected, 0);
  console.log(JSON.stringify({ version, packageSha256: createHash('sha256').update(readFileSync(options['--package'])).digest('hex'), previousVersion: previous.version, upgradeSource: options['--previous'] ? 'actual-package' : 'four-skill-model', freshSkills: fresh, skills: updated, targets: 4, exports: 8, template: 'exact-target and finite boundaries verified', diagnostics: 'installed process/report/JUnit/CI detail preservation verified', storage: 'installed reservations, lease gaps, immutable partial evidence and mid-Run selected cleanup verified' }));
} finally { rmSync(directory, { recursive: true, force: true }); }
