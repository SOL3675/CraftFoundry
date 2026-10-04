import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadAtlas, loadDefinitions, evaluateSurvival, validateConfig } from '../../scripts/lib/atlas-survival.mjs';
import type { DatapackVariant, Json } from '../../projects/craft-atlas/packages/core/src/types.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.CRAFTATLAS_DEFINITION_SOURCE ?? resolve(root, 'projects/craft-atlas');
const atlas = await loadAtlas(root, source);
const suite = resolve(root, 'tests/atlas-definitions/fixtures/suite.json');
function fixture(loader = 'neoforge') {
  const config = validateConfig(JSON.parse(readFileSync(suite, 'utf8')));
  const snapshot = atlas.readSnapshot(resolve(root, 'tests/atlas-definitions/fixtures/snapshot.json'));
  const packs = loadDefinitions(atlas, config, suite);
  snapshot.loader = config.target.loader = packs[0]!.targets.loader = loader;
  snapshot.loaderVersion = loader === 'fabric' ? '0.16.14' : '21.1.252';
  return { config, snapshot, packs, run: () => evaluateSurvival(atlas, snapshot, config, {}, packs) };
}
function variant(source: string, data: Json): DatapackVariant {
  const text = JSON.stringify(data);
  return { source, text, sha256: createHash('sha256').update(text).digest('hex'), data };
}
function raw(f: ReturnType<typeof fixture>, name: string, data: Json) {
  const effective = variant('mod/survival', data);
  f.snapshot.datapack!.resources.push({ id: `survival:${name}.json`, effective, stack: [effective] });
  f.snapshot.coverage.find(c => c.dataset === 'datapack')!.enumerated!++;
}

for (const loader of ['fabric', 'neoforge']) {
  test(`${loader}: effective resource and override provenance survive reviewed definitions and without-input regressions`, () => {
    const f = fixture(loader), r = f.run();
    assert.ok(r.results.cases.every(c => c.status === 'passed'), JSON.stringify(r.results));
    assert.deepEqual(r.evidence.datapack, f.snapshot.datapack);
    const p = r.evidence.definitionProcesses.find(p => p.id === 'survival:press')!;
    assert.deepEqual(p.raw, f.snapshot.recipes.at(-1)!.data, 'runtime codec data stays authoritative');
    assert.ok(p.evidence.includes('datapack:survival:press'));
    assert.equal(p.fieldHistory!.interpretation![0]!.value, 'opaque');
    assert.deepEqual(r.evidence.coverage.find(c => c.dataset === 'datapack'), r.evidence.originalCoverage.find(c => c.dataset === 'datapack'));
    const before = r.evidence.modelHash;
    const resource = f.snapshot.datapack!.resources.find(r => r.id === 'survival:recipe/press.json')!;
    resource.stack[0] = variant('mod/survival', { type: 'survival:unknown_old', arbitrary: 'shadowed' });
    const after = f.run();
    assert.notEqual(after.evidence.modelHash, before, 'shadowed evidence contributes to identity');
    assert.ok(after.results.cases.every(c => c.status === 'passed'), 'shadowed bytes do not add a route');
    assert.deepEqual(after.evidence.definitionProcesses.find(p => p.id === 'survival:press')!.inputs, p.inputs);
  });

  test(`${loader}: source-only custom recipe requires explicit execution review, preserving raw/history`, () => {
    const f = fixture(loader);
    f.snapshot.recipes = f.snapshot.recipes.filter(r => r.id !== 'survival:press');
    f.snapshot.coverage.find(c => c.dataset === 'recipes')!.enumerated!--;
    delete f.packs[0]!.operations[0]!.patch.execution;
    const unreviewed = f.run();
    assert.ok(unreviewed.results.cases.every(c => c.status === 'unsupported'));
    assert.equal(unreviewed.evidence.definitionProcesses.find(p => p.id === 'survival:press')!.execution, 'unconfirmed');
    f.packs[0]!.operations[0]!.patch.execution = 'executable';
    f.packs[0]!.operations[0]!.evidence = 'Synthetic custom API execution review, material and explicit powered context; not a game pass';
    const reviewed = f.run(), p = reviewed.evidence.definitionProcesses.find(p => p.id === 'survival:press')!;
    assert.ok(reviewed.results.cases.every(c => c.status === 'passed'), JSON.stringify(reviewed.results));
    assert.equal(p.fieldHistory!.execution![0]!.value, 'unconfirmed');
    assert.deepEqual(p.raw, f.snapshot.datapack!.resources.find(r => r.id === 'survival:recipe/press.json')!.effective.data);
    assert.ok(reviewed.evidence.details.find(c => c.id === 'custom.press_missing_input')!.analysis.status === 'unreachable');
    f.config.scenario.gameRules = {};
    assert.equal(f.run().results.cases.find(c => c.id === 'custom.press')!.status, 'unsupported', 'unknown power remains unknown');
  });

  for (const type of ['survival:unknown_serializer', 'minecraft:crafting_shapeless']) test(`${loader}: unknown/script-removed source-only ${type} cannot create outputs or close coverage`, () => {
    const f = fixture(loader);
    raw(f, 'recipe/script_removed', { type, ingredients: [{ item: 'survival:seed' }], result: { id: 'survival:no_source' } });
    const p = atlas.normalize(f.snapshot).processes.find(p => p.id === 'survival:script_removed')!;
    assert.equal(p.interpretation, 'opaque'); assert.equal(p.execution, 'unconfirmed');
    assert.deepEqual(p.inputs, []); assert.deepEqual(p.outputs, []);
    const r = f.run();
    assert.ok(r.results.cases.every(c => c.status === 'unsupported'));
    assert.equal(r.evidence.scenario.closed, false);
    assert.ok(r.evidence.development.some(d => d.target === p.id && d.rule === 'unmapped-acquisition'));
  });

  test(`${loader}: custom-directory evidence stays unsupported even with reviewed additions and complete surveys`, () => {
    const f = fixture(loader);
    f.snapshot.datapack!.directories.push('machines');
    raw(f, 'machines/extract', { material: 'survival:custom', output: 'survival:no_source' });
    const r = f.run();
    assert.ok(r.results.cases.every(c => c.status === 'unsupported'));
    assert.equal(r.evidence.coverage.find(c => c.dataset === 'datapackInterpretation')!.status, 'unsupported');
    assert.ok(r.evidence.development.some(d => d.rule === 'raw-acquisition-review'));
    assert.equal(r.evidence.scenario.closed, false);
    assert.equal(atlas.normalize(f.snapshot).processes.some(p => p.id.includes('machines/')), false, 'no guessed custom API recipe convention');
  });

  test(`${loader}: runtime-only entries need explicit execution review and missing-material regressions`, () => {
    const f = fixture(loader);
    f.snapshot.datapack!.resources = f.snapshot.datapack!.resources.filter(r => r.id !== 'survival:recipe/known.json');
    f.snapshot.coverage.find(c => c.dataset === 'datapack')!.enumerated!--;
    const unreviewed = f.run();
    assert.ok(unreviewed.results.cases.every(c => c.status === 'unsupported'));
    assert.ok(unreviewed.evidence.development.some(d => d.rule === 'runtime-acquisition-review' && d.target === 'survival:known'));
    f.packs[0]!.operations.push({ id: 'runtime-known', selector: { id: 'survival:known' }, action: 'replace', patch: { execution: 'executable' }, evidence: 'Synthetic runtime-only API execution review', override: [] });
    f.config.mechanisms!.push({ id: 'survival:runtime-known', mod: 'survival', processes: ['survival:known'], evidence: 'Synthetic runtime hook review' });
    f.config.cases!.push({ id: 'runtime.missing_input', item: 'survival:obtainable', expected: 'unreachable', without: ['survival:seed'] });
    const reviewed = f.run();
    assert.ok(reviewed.results.cases.every(c => c.status === 'passed'), JSON.stringify(reviewed.results));
    assert.ok(reviewed.evidence.resourceDiagnostics.some(d => d.rule === 'recipe-resource-missing'));
    assert.deepEqual(reviewed.evidence.datapack, f.snapshot.datapack);
  });

  test(`${loader}: without removes reviewed equipment, stage and dimension prerequisites without seeding products`, () => {
    for (const [kind, key] of [['equipment', 'equipment'], ['stage', 'stages'], ['dimension', 'dimensions']] as const) {
      const f = fixture(loader), id = `survival:press_${kind}`;
      f.packs[0]!.operations[0]!.patch.requirements!.push({ kind, id, evidence: [] });
      f.config.scenario[key].push(id); f.config.scenario.closedResources.push(id);
      f.config.cases!.push({ id: `custom.missing_${kind}`, item: 'survival:custom', expected: 'unreachable', without: [id] });
      const r = f.run();
      assert.ok(r.results.cases.every(c => c.status === 'passed'), JSON.stringify(r.results));
      assert.equal(r.evidence.details.at(-1)!.analysis.status, 'unreachable');
      assert.equal(r.evidence.details.find(c => c.id === 'custom.press')!.analysis.status, 'reachable');
      assert.equal(r.evidence.scenario.inventory['survival:custom'], undefined);
    }
  });
}

test('source/runtime conflicts, malformed effective/shadowed resources, capture gaps and codec failures cannot be overlaid green', () => {
  for (const mode of ['conflict', 'effective-error', 'shadowed-error', 'partial', 'denominator', 'no-coverage', 'codec']) {
    const f = fixture(), resource = f.snapshot.datapack!.resources.find(r => r.id === 'survival:recipe/press.json')!;
    if (mode === 'conflict') resource.effective = variant('file/reviewed', { type: 'survival:different_serializer' });
    if (mode.endsWith('-error')) {
      const text = '{"type":', bad: DatapackVariant = { source: 'mod/broken', text, sha256: createHash('sha256').update(text).digest('hex'), data: null, error: 'Malformed JSON' };
      if (mode === 'effective-error') resource.effective = bad; else resource.stack[0] = bad;
    }
    if (mode === 'partial') f.snapshot.coverage.find(c => c.dataset === 'datapack')!.status = 'partial';
    if (mode === 'denominator') f.snapshot.coverage.find(c => c.dataset === 'datapack')!.enumerated!++;
    if (mode === 'no-coverage') f.snapshot.coverage = f.snapshot.coverage.filter(c => c.dataset !== 'datapack');
    if (mode === 'codec') { f.snapshot.recipes.at(-1)!.data = null; f.snapshot.recipes.at(-1)!.error = 'Codec refuses to serialize'; }
    const r = f.run();
    assert.ok(r.results.cases.every(c => c.status === 'unsupported'), mode);
    assert.deepEqual(r.evidence.datapack, f.snapshot.datapack, mode);
    if (mode === 'conflict' || mode.endsWith('-error')) assert.ok(r.evidence.resourceDiagnostics.length, mode);
  }
});

test('documented datapack pagination, exact IDs, runtime inspection and overlays work through the pinned source CLI', t => {
  const dir = mkdtempSync(join(tmpdir(), 'Foundry datapack 日本語 '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = fixture(), snapshot = join(dir, 'snapshot.json');
  writeFileSync(snapshot, JSON.stringify(f.snapshot));
  const cli = (...args: string[]) => {
    const result = spawnSync(process.execPath, [resolve(source, 'packages/cli/src/main.ts'), ...args, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).result;
  };
  const page = cli('datapack', '--snapshot', snapshot, '--limit', '1', '--offset', '0');
  assert.equal(page.captured, true); assert.equal(page.resources.total, 9); assert.equal(page.resources.truncated, true);
  const exact = cli('datapack', 'survival:recipe/press.json', '--snapshot', snapshot);
  assert.deepEqual(exact.resources.items[0], f.snapshot.datapack!.resources.at(-1));
  assert.deepEqual(exact.disabledPacks, ['file/disabled']);
  const definition = resolve(root, 'templates/acquisition/definitions.json');
  const reviewed = cli('datapack', 'survival:recipe/press.json', '--snapshot', snapshot, '--definitions', definition);
  assert.deepEqual(reviewed.resources, exact.resources, 'overlays preserve raw evidence in queries');
  const inspected = cli('inspect', 'survival:press', '--snapshot', snapshot);
  assert.ok(JSON.stringify(inspected).includes('datapack:survival:press'));
  delete f.snapshot.datapack; f.snapshot.coverage = f.snapshot.coverage.filter(c => c.dataset !== 'datapack');
  writeFileSync(snapshot, JSON.stringify(f.snapshot));
  assert.equal(cli('datapack', '--snapshot', snapshot).captured, false, 'legacy snapshot is missing raw evidence');
});

test('completed raw capture directories retain evidence and reject altered datapack bytes before analysis', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'Foundry capture 日本語 '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { writeSnapshot } = await import(pathToFileURL(resolve(source, 'packages/core/src/snapshot.ts')).href);
  const f = fixture(), capture = join(dir, 'capture');
  writeSnapshot(capture, f.snapshot);
  const restored = atlas.readSnapshot(capture);
  assert.deepEqual(restored.datapack, f.snapshot.datapack);
  assert.ok(evaluateSurvival(atlas, restored, f.config, {}, f.packs).results.cases.every(c => c.status === 'passed'));
  const manifest = JSON.parse(readFileSync(join(capture, 'manifest.json'), 'utf8'));
  assert.ok(manifest.files['datapack.json']);
  writeFileSync(join(capture, 'datapack.json'), '{}\n');
  assert.throws(() => atlas.readSnapshot(capture), /Checksum/);
});
