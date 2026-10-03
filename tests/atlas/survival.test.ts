import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, chmodSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { evaluateSurvival, loadAtlas, validateConfig, externalKinds } from '../../scripts/lib/atlas-survival.mjs';
import { parseResults, evaluateSuite } from '../../dist/adapters/test/results.js';
import { loadConfig } from '../../dist/core/config.js';
import { executeRun } from '../../dist/core/runner.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const atlas = await loadAtlas(root); // Required real submodule; missing access must fail this job.
const fixture = () => atlas.readSnapshot(resolve(root, 'tests/atlas/fixtures/snapshot.json'));
const config = () => validateConfig(JSON.parse(readFileSync(new URL('./fixtures/suite.json', import.meta.url), 'utf8')));
function one(item: string, expected: 'reachable' | 'unreachable' = 'reachable') {
  const c = config(); c.cases = [{ id: `survival.${item}`, item: `survival:${item}`, expected }]; return c;
}

for (const loader of ['fabric', 'neoforge']) test(`real Atlas ${loader} 1.21.1 normalizer and analyzer: seven closed fixture cases`, () => {
  const s = fixture(), c = config(); s.loader = c.target.loader = loader;
  s.loaderVersion = loader === 'fabric' ? '0.16.14' : '21.1.252';
  const result = evaluateSurvival(atlas, s, c);
  assert.equal(result.results.cases.length, 7);
  assert.ok(result.results.cases.every(c => c.status === 'passed'));
  const details = result.evidence.details;
  assert.ok(details.find(c => c.item === 'survival:obtainable')!.analysis.path.includes('survival:known'));
  assert.match(details.find(c => c.item === 'survival:missing')!.analysis.stopReasons[0]!.message, /missing_ingredient/);
  assert.deepEqual(details.find(c => c.item === 'survival:cycle_a')!.analysis.path, []);
  assert.ok(details.find(c => c.item === 'survival:alternative')!.analysis.path.includes('survival:alternative_available'));
  assert.ok(details.find(c => c.item === 'survival:tagged')!.analysis.evidence.includes('runtime:tags'));
  assert.match(result.evidence.snapshotHash, /^[a-f0-9]{64}$/);
});

test('a provider seed breaks a real recipe cycle; provider provenance stays in evidence', () => {
  const c = one('cycle_b'); c.providers.push({ resource: 'survival:cycle_a', kind: 'loot', availability: 'available', evidence: 'Synthetic starting acquisition from loot' });
  const r = evaluateSurvival(atlas, fixture(), c);
  assert.equal(r.results.cases[0]!.status, 'passed');
  assert.deepEqual(r.evidence.details[0]!.analysis.path, ['survival:cycle_a', 'survival:cycle_b']);
  assert.ok(r.evidence.details[0]!.providerEvidence.some(p => p.kind === 'loot'));
});

test('a survival audit fails an item with no source instead of passing a completed query', () => {
  const r = evaluateSurvival(atlas, fixture(), one('no_source'));
  assert.equal(r.evidence.details[0]!.analysis.status, 'unreachable');
  assert.equal(r.results.cases[0]!.status, 'failed');
});

test('reviewed external providers seed acquisition without claiming to simulate each mechanic', () => {
  for (const kind of externalKinds) {
    const c = one('no_source'); c.providers.push({ resource: 'survival:no_source', kind, availability: 'available', evidence: `Synthetic reviewed ${kind} source` });
    const r = evaluateSurvival(atlas, fixture(), c);
    assert.equal(r.results.cases[0]!.status, 'passed', kind);
    assert.ok(r.evidence.details[0]!.providerEvidence.some(p => p.kind === kind));
  }
});

test('all namespace items are selected by default; explicit item selection is reproducible', () => {
  const c = config(); delete c.cases;
  const all = evaluateSurvival(atlas, fixture(), c);
  assert.equal(all.results.cases.length, fixture().resources.length);
  const selected = evaluateSurvival(atlas, fixture(), c, { items: ['survival:obtainable'] });
  assert.equal(selected.results.cases.length, 1); assert.equal(selected.results.cases[0]!.status, 'passed');
  assert.throws(() => evaluateSurvival(atlas, fixture(), c, { mod: 'absent' }), /Mod absent/);
  assert.throws(() => evaluateSurvival(atlas, fixture(), c, { items: ['survival:absent'] }), /No survival cases/);
});

for (const kind of externalKinds) test(`unreviewed ${kind} coverage cannot prove no-source absence or pass a known recipe`, () => {
  const c = config(); c.externalSources = c.externalSources.filter(s => s.kind !== kind);
  const r = evaluateSurvival(atlas, fixture(), c);
  assert.ok(r.results.cases.every(c => c.status === 'unsupported'));
  assert.equal(r.evidence.details.find(c => c.item === 'survival:no_source')!.analysis.status, 'unknown');
  assert.ok(r.evidence.details[0]!.incomplete.some(reason => reason.includes(kind)));
});

test('unknown providers and open resource domains remain unknown; inventory needs provenance', () => {
  const c = one('no_source', 'unreachable');
  c.providers.push({ resource: 'survival:no_source', kind: 'trades', availability: 'unknown', evidence: 'Trade enumeration unavailable' });
  const r = evaluateSurvival(atlas, fixture(), c);
  assert.equal(r.results.cases[0]!.status, 'unsupported'); assert.equal(r.evidence.details[0]!.analysis.status, 'unknown');
  const open = one('no_source', 'unreachable'); open.scenario.closedResources = [];
  assert.equal(evaluateSurvival(atlas, fixture(), open).results.cases[0]!.status, 'unsupported');
  c.scenario.inventory = { 'survival:no_source': 1 };
  assert.throws(() => evaluateSurvival(atlas, fixture(), c), /evidence-backed provider/);
});

test('partial completion/coverage, incorrect denominators and an opaque recipe never produce a suite pass', () => {
  for (const variant of ['completion', 'coverage', 'denominator', 'opaque']) {
    const s = fixture();
    if (variant === 'completion') s.completion.status = 'partial';
    if (variant === 'coverage') s.coverage[0]!.status = 'partial';
    if (variant === 'denominator') s.coverage[0]!.enumerated!++;
    if (variant === 'opaque') { s.recipes.push({ id: 'survival:opaque', type: 'survival:unknown_machine', data: {} }); s.coverage[0]!.enumerated!++; }
    const r = evaluateSurvival(atlas, s, one('no_source', 'unreachable'));
    assert.equal(r.results.cases[0]!.status, 'unsupported', variant);
    assert.equal(r.evidence.details[0]!.analysis.status, 'unknown', variant);
  }
});

test('OR ingredients use captured candidates; custom predicates/components stay unsupported', () => {
  const s = fixture(), c = one('obtainable');
  const raw = s.recipes[0]!.data as { ingredients: unknown[] };
  raw.ingredients = [[{ item: 'survival:missing_ingredient' }, { item: 'survival:seed' }]];
  assert.equal(evaluateSurvival(atlas, s, c).results.cases[0]!.status, 'passed');
  raw.ingredients = [{ type: 'survival:predicate', item: 'survival:seed' }];
  assert.equal(evaluateSurvival(atlas, s, c).results.cases[0]!.status, 'unsupported');
  raw.ingredients = [{ item: 'survival:seed', components: { damage: 0 } }];
  assert.equal(evaluateSurvival(atlas, s, c).results.cases[0]!.status, 'unsupported');
});

test('finite stock does not prove a feasible acquisition schedule', () => {
  const c = one('obtainable'); c.scenario.supply = 'finite';
  const r = evaluateSurvival(atlas, fixture(), c);
  assert.equal(r.results.cases[0]!.status, 'unsupported');
  assert.match(r.results.cases[0]!.message, /Finite inventory/);
});

for (const [minecraft, loader] of [['1.20.1', 'fabric'], ['1.21.1', 'forge'], ['1.21.2', 'neoforge']]) test(`out-of-scope ${loader} ${minecraft} is unsupported`, () => {
  const s = fixture(), c = one('no_source', 'unreachable');
  s.minecraft = c.target.minecraft = minecraft!; s.loader = c.target.loader = loader!;
  const r = evaluateSurvival(atlas, s, c);
  assert.equal(r.results.cases[0]!.status, 'unsupported'); assert.equal(r.evidence.details[0]!.analysis.status, 'unknown');
  assert.match(r.results.cases[0]!.message, /supported: Fabric\/NeoForge 1.21.1/);
});

test('Atlas-owned fixture data yields an actual route while its unsupported coverage blocks a pass', () => {
  const s = atlas.readSnapshot(resolve(root, 'projects/craft-atlas/fixtures/before.json'));
  const c = config(); delete c.mod;
  c.scenario = JSON.parse(readFileSync(resolve(root, 'projects/craft-atlas/fixtures/scenario.json'), 'utf8'));
  c.providers = ['minecraft:dirt', 'minecraft:stick'].map(resource => ({ resource, kind: 'harvesting', availability: 'available' as const, evidence: 'Atlas synthetic fixture starting inventory, not live-game proof' }));
  c.cases = [{ id: 'atlas.fixture.diamond', item: 'minecraft:diamond', expected: 'reachable' }];
  const r = evaluateSurvival(atlas, s, c);
  assert.equal(r.evidence.details[0]!.analysis.status, 'reachable');
  assert.ok(r.evidence.details[0]!.analysis.path.includes('atlas:diamond'));
  assert.ok(r.evidence.details[0]!.analysis.evidence.includes('runtime:tags'));
  assert.equal(r.results.cases[0]!.status, 'unsupported');
  assert.ok(r.evidence.details[0]!.incomplete.some(reason => reason.includes('loot')));
});

test('snapshot target mismatch, invalid input and missing targets fail before any results', () => {
  const c = config(); c.target.loader = 'fabric';
  assert.throws(() => evaluateSurvival(atlas, fixture(), c), /does not match/);
  assert.throws(() => validateConfig({ ...config(), typo: true }), /configuration/);
  const duplicate = config(); duplicate.cases!.push(duplicate.cases![0]!);
  assert.throws(() => validateConfig(duplicate), /Duplicate/);
  assert.throws(() => evaluateSurvival(atlas, fixture(), one('absent')), /absent from captured registry/);
});

test('real CLI produces harness-compatible fresh results and diagnostics in a Unicode space path', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'survival 日本語 ')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'results.json');
  const c = config(); c.snapshot = resolve(root, 'tests/atlas/fixtures/snapshot.json');
  const input = join(dir, 'suite.json'); writeFileSync(input, JSON.stringify(c));
  const run = (extra: string[] = []) => spawnSync(process.execPath, [resolve(root, 'scripts/atlas-survival.mjs'), '--config', input, '--results', output, ...extra], { cwd: dir, encoding: 'utf8' });
  const passed = run(); assert.equal(passed.status, 0, passed.stderr);
  const cases = await parseResults(output);
  assert.equal(evaluateSuite('survival', { driver: 'process', expectedTests: c.cases!.map(c => c.id), minTests: 7 }, cases, true).status, 'passed');
  const evidence = JSON.parse(readFileSync(output + '.evidence.json', 'utf8'));
  assert.match(evidence.atlasCommit, /^[a-f0-9]{40}$/); assert.equal(evidence.details.length, 7);
  c.externalSources[0]!.status = 'unsupported'; writeFileSync(input, JSON.stringify(c));
  assert.equal(run().status, 1);
  const incomplete = await parseResults(output);
  assert.ok(incomplete.every(c => c.status === 'unsupported'));
  assert.equal(evaluateSuite('survival', { driver: 'process' }, incomplete, true).status, 'failed');
  assert.equal(run(['--harness']).status, 0, 'harness transport must expose unsupported cases to its evaluator');
  assert.equal(run(['--unknown', 'value']).status, 2);
});

test('actual Foundry process suite evaluates Atlas cases and saves an auditable Run', async t => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'Foundry Atlas 日本語 ')));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  // Only the build transport is a fixture: the harness, process driver, Atlas APIs,
  // snapshot and case evaluation below are real. This is not a Minecraft run.
  writeFileSync(join(project, 'gradlew.bat'), '@echo off\r\nexit /b 0\r\n');
  writeFileSync(join(project, 'gradlew'), '#!/bin/sh\nexit 0\n'); chmodSync(join(project, 'gradlew'), 0o755);
  mkdirSync(join(project, 'build/libs'), { recursive: true });
  writeFileSync(join(project, 'build/libs/fixture.jar'), 'Offline artifact identity fixture');
  writeFileSync(join(project, 'manifest.json'), JSON.stringify({ schemaVersion: 1, target: 'neoforge-1.21.1', minecraft: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.252', artifacts: [{ path: 'build/libs/fixture.jar', kind: 'distribution', side: 'both' }] }));
  const c = config(); c.snapshot = resolve(root, 'tests/atlas/fixtures/snapshot.json');
  writeFileSync(join(project, 'survival.json'), JSON.stringify(c));
  writeFileSync(join(project, 'harness.config.json'), JSON.stringify({ schemaVersion: 1, projectId: 'atlas-offline',
    builds: { main: { root: '.', adapter: 'gradle' } },
    targets: { 'neoforge-1.21.1': { minecraft: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.252', build: 'main', tasks: { build: ['assemble'] }, artifactManifest: 'manifest.json', requiredSuites: ['survival-acquisition'] } },
    suites: { 'survival-acquisition': { driver: 'process', runtime: 'atlas', results: 'survival-results.json', minTests: 7, expectedTests: c.cases!.map(c => c.id), requiredCapabilities: ['atlas-saved-snapshot'] } },
    runtimes: { atlas: { kind: 'server', capabilities: ['atlas-saved-snapshot'], command: { executable: process.execPath, args: [resolve(root, 'scripts/atlas-survival.mjs'), '--config', '{projectRoot}/survival.json', '--results', '{sessionRoot}/survival-results.json', '--harness'] } } },
  }));
  const loaded = await loadConfig(project);
  const run = () => executeRun(loaded, { command: 'test', targets: ['neoforge-1.21.1'] });
  const passed = await run(); assert.equal(passed.status, 'passed', JSON.stringify(passed.targets));
  assert.equal(passed.targets[0]!.suites[0]!.detected, 7);
  const evidence = join(project, '.harness/runs', passed.id, 'sessions/neoforge-1.21.1/survival-acquisition/survival-results.json.evidence.json');
  assert.equal(JSON.parse(readFileSync(evidence, 'utf8')).details.length, 7);
  c.externalSources[0]!.status = 'partial'; writeFileSync(join(project, 'survival.json'), JSON.stringify(c));
  const incomplete = await run(); assert.equal(incomplete.status, 'failed');
  assert.equal(incomplete.targets[0]!.suites[0]!.detected, 7);
  assert.ok(incomplete.targets[0]!.suites[0]!.cases.every(c => c.status === 'unsupported'));
  c.externalSources[0]!.status = 'complete'; c.cases![1]!.expected = 'reachable'; writeFileSync(join(project, 'survival.json'), JSON.stringify(c));
  const failed = await run(); assert.equal(failed.status, 'failed');
  assert.equal(failed.targets[0]!.suites[0]!.cases.find(c => c.id === 'survival.no_source')!.status, 'failed');
});
