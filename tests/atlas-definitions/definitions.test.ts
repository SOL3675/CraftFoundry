import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadAtlas, loadDefinitions, evaluateSurvival, validateConfig } from '../../scripts/lib/atlas-survival.mjs';
import { loadConfig } from '../../dist/core/config.js';
import { executeRun } from '../../dist/core/runner.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.CRAFTATLAS_DEFINITION_SOURCE ?? resolve(root, 'projects/craft-atlas');
const sourceOptions = source === resolve(root, 'projects/craft-atlas') ? [] : ['--atlas-source', source];
const atlas = await loadAtlas(root, source);
assert.equal(atlas.definitionContractVersion, 2, 'Requires upgraded Atlas contract; use --atlas-source until the reviewed commit is published and pinned');
const suite = resolve(root, 'tests/atlas-definitions/fixtures/suite.json');
const config = () => validateConfig(JSON.parse(readFileSync(suite, 'utf8')));
const fixture = () => atlas.readSnapshot(resolve(root, 'tests/atlas-definitions/fixtures/snapshot.json'));
const packs = () => loadDefinitions(atlas, config(), suite);

for (const loader of ['fabric', 'neoforge']) test(`${loader}: custom serializer and code transformation run through actual Atlas`, () => {
  const c = config(), s = fixture(), definitions = packs(); c.target.loader = s.loader = definitions[0]!.targets.loader = loader; s.loaderVersion = loader === 'fabric' ? '0.16.14' : '21.1.252';
  const r = evaluateSurvival(atlas, s, c, {}, definitions);
  assert.equal(r.results.cases.length, 10);
  assert.ok(r.results.cases.every(c => c.status === 'passed'), JSON.stringify(r.results));
  assert.ok(r.evidence.details.find(d => d.id === 'custom.extract')!.analysis.path.includes('survival:press'));
  assert.ok(r.evidence.details.find(d => d.id === 'custom.extract')!.analysis.path.includes('survival:extract'));
  assert.equal(r.evidence.details.find(d => d.id === 'custom.press_missing_input')!.analysis.status, 'unreachable');
  assert.ok(r.evidence.details.find(d => d.id === 'custom.press')!.analysis.evidence.some(e => e.startsWith('definition:')));
  assert.equal(r.evidence.originalCoverage.find(c => c.type === 'survival:press')!.status, 'partial');
  assert.equal(r.evidence.coverage.find(c => c.type === 'survival:press')!.status, 'complete');
  assert.match(r.evidence.definitions[0]!.hash, /^[a-f0-9]{64}$/);
});
test('missing custom mapping, tests, unknown Java hook and unsupported serializers produce actionable unsupported results', () => {
  for (const variant of ['mapping', 'tests', 'hook', 'unmapped', 'declaration']) {
    const c = config(), definitions = packs();
    if (variant === 'mapping') c.mechanisms![0]!.processes = ['survival:missing_process'];
    if (variant === 'tests') c.cases = c.cases!.filter(c => !c.without);
    if (variant === 'hook') c.mechanisms![0]!.unknown = 'Java runtime power hook cannot be verified';
    if (variant === 'unmapped') definitions[0]!.operations = [];
    if (variant === 'declaration') c.mechanisms = [];
    const r = evaluateSurvival(atlas, fixture(), c, {}, definitions);
    assert.ok(r.results.cases.every(c => c.status === 'unsupported'), variant);
    assert.ok(r.evidence.development.length, variant);
    assert.ok(r.evidence.details[0]!.incomplete.some(reason => /definition|tests|regression|mapping|mechanisms|absent|hook|serializer/.test(reason)), variant);
  }
});
test('duplicates, mismatched versions, unresolved tags/resources and conflicts never pass', () => {
  for (const variant of ['duplicate', 'version', 'resource', 'tag', 'conflict']) {
    const c = config(), definitions = packs();
    if (variant === 'duplicate') { c.definitions!.push('duplicate.json'); definitions.push(structuredClone(definitions[0]!)); }
    if (variant === 'version') definitions[0]!.targets.mods[0]!.versions = ['different'];
    if (variant === 'resource') definitions[0]!.additions[0]!.outputs[0]!.resource = 'survival:absent';
    if (variant === 'tag') definitions[0]!.operations[0]!.patch.inputs![0]!.alternatives[0]!.tag = 'survival:absent';
    if (variant === 'conflict') { c.definitions!.push('other.json'); const other = structuredClone(definitions[0]!); other.id = 'survival:other'; definitions.push(other); }
    const r = evaluateSurvival(atlas, fixture(), c, {}, definitions);
    assert.ok(r.results.cases.every(c => c.status === 'unsupported'), variant);
    assert.ok(r.evidence.definitionDiagnostics.some(d => d.rule !== 'definition-runtime-contradiction'), variant);
  }
});
test('conditions and partial captures retain unknown without false green', () => {
  for (const variant of ['condition', 'capture', 'serialization', 'survey', 'cost']) {
    const c = config(), s = fixture(), definitions = packs();
    if (variant === 'condition') c.scenario.gameRules = {};
    if (variant === 'serialization') { s.recipes.at(-1)!.data = null; s.recipes.at(-1)!.error = 'Codec acquisition failed'; }
    if (variant === 'capture') s.coverage[0]!.status = 'partial';
    if (variant === 'survey') c.externalSources[0]!.status = 'unsupported';
    if (variant === 'cost') definitions[0]!.additions[0]!.costs = [{ kind: 'time', amount: null, unit: 'tick', basis: 'not measured' }];
    const r = evaluateSurvival(atlas, s, c, {}, definitions);
    assert.equal(r.results.cases.find(c => c.id === 'custom.extract')!.status, 'unsupported', variant);
  }
});
test('invalid, missing or incompletely loaded packs stop before analysis', () => {
  const c = config(), definitions = packs();
  assert.throws(() => evaluateSurvival(atlas, fixture(), c), /all be loaded/);
  definitions[0]!.additions[0]!.inputs[0]!.amount = 0;
  assert.throws(() => evaluateSurvival(atlas, fixture(), c, {}, definitions), /definitions/);
  c.definitions = ['not-present.json']; assert.throws(() => loadDefinitions(atlas, c, suite), /ENOENT/);
  assert.throws(() => validateConfig({ ...config(), mechanisms: [{ id: 'bad', mod: 'survival', processes: [], evidence: 'x' }] }), /configuration/);
});
test('pinned Atlas capability is respected and old APIs explicitly reject new packs', async () => {
  const old = await loadAtlas(root);
  if (old.definitionContractVersion === 2) assert.ok(evaluateSurvival(old, fixture(), config(), {}, packs()).results.cases.every(c => c.status === 'passed'));
  else assert.throws(() => evaluateSurvival(old, fixture(), config(), {}, packs()), /contract v2 required/);
});

test('Foundry process suite executes custom cases through the default pin or explicit development source', async t => {
  const project = mkdtempSync(join(tmpdir(), 'Custom acquisition 日本語 ')); t.after(() => rmSync(project, { recursive: true, force: true }));
  writeFileSync(join(project, 'gradlew'), '#!/bin/sh\nexit 0\n'); chmodSync(join(project, 'gradlew'), 0o755);
  writeFileSync(join(project, 'gradlew.bat'), '@echo off\r\nexit /b 0\r\n');
  mkdirSync(join(project, 'build/libs'), { recursive: true }); writeFileSync(join(project, 'build/libs/fixture.jar'), 'Offline contract, not a game build');
  writeFileSync(join(project, 'manifest.json'), JSON.stringify({ schemaVersion: 1, target: 'neoforge-1.21.1', minecraft: '1.21.1', loader: 'neoforge', artifacts: [{ path: 'build/libs/fixture.jar', kind: 'distribution', side: 'both' }] }));
  const c = config(); c.snapshot = resolve(root, 'tests/atlas-definitions/fixtures/snapshot.json'); c.definitions = [resolve(root, 'templates/acquisition/definitions.json')];
  const input = join(project, 'survival.json'); writeFileSync(input, JSON.stringify(c));
  writeFileSync(join(project, 'harness.config.json'), JSON.stringify({ schemaVersion: 1, projectId: 'custom-offline', builds: { main: { root: '.', adapter: 'gradle' } },
    targets: { 'neoforge-1.21.1': { minecraft: '1.21.1', loader: 'neoforge', build: 'main', tasks: { build: ['assemble'] }, artifactManifest: 'manifest.json', requiredSuites: ['acquisition'] } },
    suites: { acquisition: { driver: 'process', runtime: 'atlas', results: 'results.json', minTests: 10, expectedTests: c.cases!.map(c => c.id) } },
    runtimes: { atlas: { kind: 'server', capabilities: [], command: { executable: process.execPath, args: [resolve(root, 'scripts/atlas-survival.mjs'), '--config', '{projectRoot}/survival.json', '--results', '{sessionRoot}/results.json', ...sourceOptions, '--harness'] } } } }));
  const loaded = await loadConfig(project), run = () => executeRun(loaded, { command: 'test', targets: ['neoforge-1.21.1'] });
  const passed = await run(); assert.equal(passed.status, 'passed', JSON.stringify(passed.targets));
  assert.equal(passed.targets[0]!.suites[0]!.detected, 10);
  const evidence = JSON.parse(readFileSync(join(project, '.harness/runs', passed.id, 'sessions/neoforge-1.21.1/acquisition/results.json.evidence.json'), 'utf8'));
  assert.equal(evidence.atlasSource, sourceOptions.length ? 'explicit-local-development' : 'pinned-submodule'); assert.match(evidence.atlasCommit, /^[a-f0-9]{40}$/);
  c.mechanisms![0]!.unknown = 'Unverifiable dynamic hook'; writeFileSync(input, JSON.stringify(c));
  const failed = await run(); assert.equal(failed.status, 'failed');
  assert.ok(failed.targets[0]!.suites[0]!.cases.every(c => c.status === 'unsupported'));
  c.definitions = ['missing.json']; writeFileSync(input, JSON.stringify(c));
  const invalid = spawnSync(process.execPath, [resolve(root, 'scripts/atlas-survival.mjs'), '--config', input, '--results', join(project, 'invalid-results.json'), ...sourceOptions], { encoding: 'utf8' });
  assert.equal(invalid.status, 2); assert.throws(() => readFileSync(join(project, 'invalid-results.json')), /ENOENT/);
});
