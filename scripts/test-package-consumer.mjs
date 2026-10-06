import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, chmodSync, copyFileSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const updated = install(), provenance = metadata();
  assert.equal(provenance.version, version);
  if (previous) {
    assert.equal(readFileSync(join(destination, 'project-setup/SKILL.md'), 'utf8'), 'Consumer customization must survive the actual package upgrade\n');
    assert.deepEqual(provenance.files['project-setup/SKILL.md'], previous.files['project-setup/SKILL.md']);
    for (const name of ['development-loop', 'porting', 'troubleshooting']) {
      const file = `${name}/SKILL.md`, bytes = readFileSync(join(destination, file));
      assert.equal(provenance.files[file].version, version);
      assert.equal(provenance.files[file].sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.match(bytes.toString(), /Forge\/Fabric 1\.20\.1|1\.20\.1 collectors/);
    }
  }
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
  execFileSync(process.execPath, ['--input-type=module', '-e', "for (const part of ['core/config','core/cache','core/tools','core/types','adapters/runtime/server','adapters/runtime/mc-pilot']) await import('craft-foundry/' + part)"], { cwd: directory, encoding: 'utf8' });
  writeFileSync(join(directory, 'case-contract.ts'), `import type { CaseResult } from 'craft-foundry/core/types';
const result: CaseResult = {id:'survival.item',status:'unsupported',message:'Human summary',detail:{file:'results.json.evidence.json',pointer:'/details/0'},diagnostics:{schemaVersion:1,counts:{incomplete:1,unknown:0,stopReasons:0}}};
export {result};`);
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), 'case-contract.ts'], { cwd: directory, encoding: 'utf8' });
  const listed = cli('targets', '--project', packageRoot, '--json');
  assert.ok(JSON.stringify(listed).includes('forge-1.20.1') && JSON.stringify(listed).includes('fabric-1.20.1'));
  // The repository-only Atlas producer is not shipped. Its optional result metadata
  // must still survive the installed process driver, report CLI and CI template.
  mkdirSync(join(directory, 'build/libs'), { recursive: true });
  writeFileSync(join(directory, 'build/libs/fixture.jar'), 'Offline contract artifact');
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, target: 'fabric', minecraft: '1.21.1', loader: 'fabric', artifacts: [{ path: 'build/libs/fixture.jar', kind: 'distribution', side: 'both' }] }));
  writeFileSync(join(directory, 'gradlew.bat'), '@echo off\r\nexit /b 0\r\n');
  writeFileSync(join(directory, 'gradlew'), '#!/bin/sh\nexit 0\n'); chmodSync(join(directory, 'gradlew'), 0o755);
  writeFileSync(join(directory, 'produce.mjs'), `import {writeFileSync} from 'node:fs';
if (!process.argv.includes('--missing-detail')) writeFileSync('results.json.evidence.json', JSON.stringify({schemaVersion:2,diagnosticContractVersion:1,incomplete:['Complete detail 日本語🌋 <&> '.repeat(100000)],details:[{incompleteRef:'#/incomplete',analysis:{unknown:[],stopReasons:[]}}]}));
writeFileSync('results.json', JSON.stringify({schemaVersion:1,cases:[{id:'survival.item',status:process.argv.includes('--missing-detail')?'passed':'unsupported',message:'Unknown acquisition; Next: review the evidence and capture',diagnostics:{schemaVersion:1,counts:{incomplete:1,unknown:0,stopReasons:0}},detail:{file:'results.json.evidence.json',pointer:'/details/0'}}]}));`);
  writeFileSync(join(directory, 'harness.config.json'), JSON.stringify({ schemaVersion: 1, projectId: 'packed-diagnostics',
    builds: { main: { root: '.', adapter: 'gradle' } },
    targets: { fabric: { minecraft: '1.21.1', loader: 'fabric', build: 'main', tasks: { build: ['assemble'] }, artifactManifest: 'manifest.json', requiredSuites: ['survival'] } },
    suites: { survival: { driver: 'process', runtime: 'analysis', results: 'results.json', expectedTests: ['survival.item'] } },
    runtimes: { analysis: { kind: 'server', capabilities: [], command: { executable: process.execPath, args: ['{projectRoot}/produce.mjs'] } } },
  }));
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
  console.log(JSON.stringify({ version, packageSha256: createHash('sha256').update(readFileSync(options['--package'])).digest('hex'), previousVersion: previous?.version ?? null, skills: updated, targets: 4, exports: 6, template: 'exact-target and finite boundaries verified', diagnostics: 'installed process/report/JUnit/CI detail preservation verified' }));
} finally { rmSync(directory, { recursive: true, force: true }); }
