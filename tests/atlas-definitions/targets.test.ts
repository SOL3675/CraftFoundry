import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadAtlas, loadDefinitions, evaluateSurvival, validateConfig } from '../../scripts/lib/atlas-survival.mjs';
import { loadConfig } from '../../dist/core/config.js';
import { executeRun } from '../../dist/core/runner.js';
import { targets, targetFixture } from '../atlas/fixtures/targets.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.CRAFTATLAS_DEFINITION_SOURCE ?? resolve(root, 'projects/craft-atlas');
const atlas = await loadAtlas(root, source);
const { writeSnapshot } = await import(pathToFileURL(resolve(source, 'packages/core/src/snapshot.ts')).href);
const suite = resolve(root, 'tests/atlas-definitions/fixtures/suite.json');
function fixture(target: typeof targets[number]) {
  const config = validateConfig(JSON.parse(readFileSync(suite, 'utf8')));
  const packs = loadDefinitions(atlas, config, suite);
  const snapshot = targetFixture(atlas.readSnapshot(resolve(root, 'tests/atlas-definitions/fixtures/snapshot.json')), target, packs);
  Object.assign(config.target, { minecraft: target.minecraft, loader: target.loader });
  snapshot.generation = 1;
  const observations = JSON.parse(readFileSync(resolve(root, 'tests/atlas/fixtures/observations.json'), 'utf8'));
  for (const observation of observations) Object.assign(observation, {
    session: snapshot.session, generation: snapshot.generation, environmentHash: atlas.hash(snapshot.environment),
    minecraft: target.minecraft, loader: target.loader, loaderVersion: target.loaderVersion,
  });
  const run = () => evaluateSurvival(atlas, snapshot, config, {}, packs);
  const observe = () => {
    snapshot.world = { lootTables: [], lootModifiers: [], lootSources: [], biomes: [], dimensions: [], features: [], observations, limitations: ['Synthetic finite observation contract only'] };
    snapshot.coverage.push({ dataset: 'observationCommands', type: 'loot/block/entity/world', status: target.id === 'fabric-1.21.1' ? 'unsupported' : 'complete', enumerated: 4, interpreted: null, reasons: ['Command registration is independent of finite samples'] },
      { dataset: 'observation', type: 'finite samples', status: 'partial', enumerated: 4, interpreted: null, reasons: ['Finite samples cannot close coverage'] });
  };
  return { config, packs, snapshot, observations, run, observe };
}

for (const target of targets) {
  test(`${target.id}: exact definitions, resource paths and failed serializers preserve unknown boundaries`, () => {
    const original = fixture(target);
    assert.ok(original.run().results.cases.every(c => c.status === 'passed'));
    for (const mode of ['wrong-definition-target', 'wrong-resource-directory', 'missing-json', 'partial-capture', 'unknown-hook']) {
      const f = fixture(target);
      if (mode === 'wrong-definition-target') f.packs[0]!.targets.minecraft = target.minecraft === '1.20.1' ? '1.21.1' : '1.20.1';
      if (mode === 'wrong-resource-directory') {
        const resource = f.snapshot.datapack!.resources.find(r => r.id.endsWith('/press.json'))!;
        resource.id = resource.id.replace(target.minecraft === '1.20.1' ? ':recipes/' : ':recipe/', target.minecraft === '1.20.1' ? ':recipe/' : ':recipes/');
      }
      if (mode === 'missing-json') f.snapshot.recipes.at(-1)!.data = null;
      if (mode === 'partial-capture') f.snapshot.completion.status = 'partial';
      if (mode === 'unknown-hook') f.config.mechanisms![0]!.unknown = 'Unreviewed arbitrary Java hook';
      const result = f.run();
      assert.ok(result.results.cases.every(c => c.status === 'unsupported'), mode);
      assert.deepEqual(result.evidence.recipes, f.snapshot.recipes);
      assert.deepEqual(result.evidence.datapack, f.snapshot.datapack);
    }
    if (target.minecraft === '1.20.1') {
      const f = fixture(target);
      f.snapshot.recipes.at(-1)!.serialization!.error = 'Synthetic network encoder failure';
      assert.ok(f.run().results.cases.every(c => c.status === 'unsupported'));
      const bad = fixture(target); bad.snapshot.recipes.at(-1)!.serialization!.bytesBase64 = 'AQ==';
      assert.throws(bad.run, /checksum/);
    }
  });

  test(`${target.id}: finite evidence, NBT and bounds survive overlays without proving acquisition or absence`, t => {
    const f = fixture(target); f.observe();
    const result = f.run();
    assert.ok(result.results.cases.every(c => c.status === 'unsupported'));
    assert.equal(result.evidence.scenario.closed, false);
    assert.deepEqual(result.evidence.world, f.snapshot.world);
    assert.deepEqual(result.evidence.recipes, f.snapshot.recipes);
    assert.deepEqual(result.evidence.datapack, f.snapshot.datapack);
    assert.equal(result.evidence.observationProcesses.length, 4);
    for (const process of result.evidence.observationProcesses) {
      assert.equal(process.execution, 'display'); assert.equal(process.interpretation, 'opaque');
      assert.deepEqual(process.raw, f.observations.find((o: { id: string }) => `observation:${o.id}` === process.id));
      assert.ok(process.outputs.every(o => o.probability === null));
    }
    assert.ok(result.evidence.sourceEvidence.some(e => e.kind === 'observation'));
    assert.deepEqual(result.evidence.coverage.find(c => c.dataset === 'observation'), result.evidence.originalCoverage.find(c => c.dataset === 'observation'));
    assert.ok(result.evidence.definitionProcesses.find(p => p.id === 'survival:press')!.fieldHistory!.interpretation!.length);
    const sampleOnly = structuredClone(f.config); sampleOnly.scenario.inventory = {}; sampleOnly.providers = [];
    sampleOnly.scenario.allowedTypes = ['minecraft:observation']; sampleOnly.cases = [{ id: 'sample', item: 'survival:no_source', expected: 'reachable' }];
    assert.notEqual(evaluateSurvival(atlas, f.snapshot, sampleOnly, {}, f.packs).evidence.details[0]!.analysis.status, 'reachable');
    // Even a missing or falsely complete finite-coverage row cannot turn a sample into a proof.
    f.snapshot.coverage = f.snapshot.coverage.filter(c => !c.dataset.startsWith('observation'));
    assert.ok(f.run().results.cases.every(c => c.status === 'unsupported'));
    f.snapshot.coverage.push({ dataset: 'observation', type: '*', status: 'complete', enumerated: 4, interpreted: 4, reasons: [] });
    assert.ok(f.run().results.cases.every(c => c.status === 'unsupported'));
    const directory = mkdtempSync(join(tmpdir(), 'Foundry finite capture ')); t.after(() => rmSync(directory, { recursive: true, force: true }));
    writeSnapshot(join(directory, 'capture'), f.snapshot);
    const restored = atlas.readSnapshot(join(directory, 'capture'));
    assert.deepEqual(restored.world!.observations, f.observations);
    assert.ok(evaluateSurvival(atlas, restored, f.config, {}, f.packs).results.cases.every(c => c.status === 'unsupported'));
    writeFileSync(join(directory, 'capture/world.json'), '{}');
    assert.throws(() => atlas.readSnapshot(join(directory, 'capture')), /Checksum/);
  });

  test(`${target.id}: stale observation identity and missing viewer generation cannot be reused`, () => {
    for (const key of ['session', 'generation', 'environmentHash']) {
      const f = fixture(target); f.observe(); f.observations[0][key] = key === 'generation' ? 99 : 'stale';
      assert.throws(f.run, /Stale|observation-1.20.1/);
    }
    const f = fixture(target);
    f.snapshot.viewer = { session: f.snapshot.session, generation: f.snapshot.generation, kind: target.loader === 'fabric' ? 'emi' : 'jei', version: 'synthetic', context: { limitations: ['Synthetic viewer only; Forge fluid runtime unverified'] }, coverage: [], recipes: [{
      id: 'unique-viewer-entry', recipeId: 'survival:known', category: 'minecraft:crafting', inputs: [], outputs: [{ resource: 'survival:obtainable', amount: 2, unit: 'item', role: 'primary', probability: null, evidence: [] }], equipment: [], execution: 'display', unknown: ['Synthetic viewer execution unconfirmed'], raw: { amount: 2 },
    }] };
    const result = f.run(); assert.deepEqual(result.evidence.viewer, f.snapshot.viewer);
    assert.ok(result.evidence.sourceEvidence.some(e => e.kind === 'viewer'));
    f.snapshot.viewer.generation++;
    assert.throws(f.run, /Stale viewer/);
  });

  test(`${target.id}: default pinned process suite passes reviewed routes and fails required finite samples`, async t => {
    const project = mkdtempSync(join(tmpdir(), 'Foundry target 日本語 ')); t.after(() => rmSync(project, { recursive: true, force: true }));
    const f = fixture(target);
    writeFileSync(join(project, 'gradlew'), '#!/bin/sh\nexit 0\n'); chmodSync(join(project, 'gradlew'), 0o755);
    writeFileSync(join(project, 'gradlew.bat'), '@echo off\r\nexit /b 0\r\n');
    mkdirSync(join(project, 'build/libs'), { recursive: true }); writeFileSync(join(project, 'build/libs/fixture.jar'), 'Synthetic contract only');
    writeFileSync(join(project, 'manifest.json'), JSON.stringify({ schemaVersion: 1, target: target.id, minecraft: target.minecraft, loader: target.loader, loaderVersion: target.loaderVersion, artifacts: [{ path: 'build/libs/fixture.jar', kind: 'distribution', side: 'both' }] }));
    f.config.snapshot = 'snapshot.json'; f.config.definitions = ['definitions.json'];
    writeFileSync(join(project, 'survival.json'), JSON.stringify(f.config)); writeFileSync(join(project, 'definitions.json'), JSON.stringify(f.packs[0]));
    writeFileSync(join(project, 'snapshot.json'), JSON.stringify(f.snapshot));
    writeFileSync(join(project, 'harness.config.json'), JSON.stringify({ schemaVersion: 1, projectId: 'four-target-offline', builds: { main: { root: '.', adapter: 'gradle' } },
      targets: { [target.id]: { minecraft: target.minecraft, loader: target.loader, loaderVersion: target.loaderVersion, build: 'main', tasks: { build: ['assemble'] }, artifactManifest: 'manifest.json', requiredSuites: ['acquisition'] } },
      suites: { acquisition: { driver: 'process', runtime: 'atlas', results: 'results.json', minTests: 10, expectedTests: f.config.cases!.map(c => c.id) } },
      runtimes: { atlas: { kind: 'server', capabilities: [], command: { executable: process.execPath, args: [resolve(root, 'scripts/atlas-survival.mjs'), '--config', '{projectRoot}/survival.json', '--results', '{sessionRoot}/results.json', '--harness'] } } },
    }));
    const loaded = await loadConfig(project), run = () => executeRun(loaded, { command: 'test', targets: [target.id], profile: 'release' });
    const passed = await run(); assert.equal(passed.status, 'passed', JSON.stringify(passed.targets));
    f.observe(); writeFileSync(join(project, 'snapshot.json'), JSON.stringify(f.snapshot));
    const failed = await run(); assert.equal(failed.status, 'failed');
    assert.equal(failed.targets[0]!.suites[0]!.detected, 10);
    assert.ok(failed.targets[0]!.suites[0]!.cases.every(c => c.status === 'unsupported'));
    const evidence = JSON.parse(readFileSync(join(project, '.harness/runs', failed.id, `sessions/${target.id}/acquisition/results.json.evidence.json`), 'utf8'));
    assert.equal(evidence.atlasSource, 'pinned-submodule');
    assert.equal(evidence.atlasCommit, execFileSync('git', ['-C', root, 'ls-files', '--stage', 'projects/craft-atlas'], { encoding: 'utf8' }).split(' ')[1]);
    assert.deepEqual(evidence.world, f.snapshot.world);
  });
}
