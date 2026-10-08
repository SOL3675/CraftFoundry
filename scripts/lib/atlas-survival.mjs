import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Ajv } from 'ajv';
import { verifyCaptureIdentity } from '../../dist/core/capture-identity.js';
import { summarizeText } from '../../src/reporting/summary.ts';

/** @typedef {import('../../projects/craft-atlas/packages/core/src/types.ts').Snapshot} Snapshot */
/** @typedef {import('../../projects/craft-atlas/packages/core/src/types.ts').Scenario} Scenario */
/** @typedef {import('../../projects/craft-atlas/packages/core/src/analyze.ts').Analysis} Analysis */
/** @typedef {{resource:string, kind:string, availability:'available'|'unknown', evidence:string}} Provider */
/** @typedef {{kind:string, status:'complete'|'partial'|'unsupported', evidence:string}} Survey */
/** @typedef {import('../../projects/craft-atlas/packages/core/src/types.ts').DefinitionPack} DefinitionPack */
/** @typedef {{id:string,mod:string,processes:string[],evidence:string,unknown?:string}} Mechanism */
/** @typedef {{schemaVersion:1, snapshot:string, captureRuntime?:string, captureFiles?:{source:string,destination:string}[], target:{minecraft:string,loader:string}, scenario:Scenario, providers:Provider[], externalSources:Survey[], definitions?:string[], mechanisms?:Mechanism[], mod?:string, items?:string[], cases?:{id:string,item:string,expected:'reachable'|'unreachable',without?:string[]}[]}} SurvivalConfig */

export const externalKinds = ['loot', 'drops', 'harvesting', 'worldgen', 'trades', 'other'];
export const supportedTargets = ['fabric:1.21.1', 'neoforge:1.21.1', 'fabric:1.20.1', 'forge:1.20.1'];
export const survivalSummaryLimit = 1800;
const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(JSON.parse(readFileSync(new URL('../../schemas/atlas-survival.schema.json', import.meta.url), 'utf8')));

/** Load the pinned checkout's source APIs without installing Atlas or its Foundry consumer dependency.
 * Node 24 strips Atlas's TypeScript; its Ajv import resolves the root's identical locked version.
 * @param {string} root
 * @param {string} [source]
 */
export async function loadAtlas(root, source) {
  const base = resolve(source ?? resolve(root, 'projects/craft-atlas'), 'packages/core/src');
  try {
    const [snapshot, normalization, analysis, validation, hashing, definitions] = await Promise.all([
      import(pathToFileURL(resolve(base, 'snapshot.ts')).href),
      import(pathToFileURL(resolve(base, 'normalize.ts')).href),
      import(pathToFileURL(resolve(base, 'analyze.ts')).href),
      import(pathToFileURL(resolve(base, 'validate.ts')).href),
      import(pathToFileURL(resolve(base, 'hash.ts')).href),
      import(pathToFileURL(resolve(base, 'definitions.ts')).href),
    ]);
    return /** @type {{captureIdentityContractVersion?: number, readSnapshot: (path:string)=>Snapshot, normalize: typeof import('../../projects/craft-atlas/packages/core/src/normalize.ts').normalize, analyze: typeof import('../../projects/craft-atlas/packages/core/src/analyze.ts').analyze, validate: typeof import('../../projects/craft-atlas/packages/core/src/validate.ts').validate, hash: (value:unknown)=>string, definitionContractVersion?: number, applyDefinitions: typeof import('../../projects/craft-atlas/packages/core/src/definitions.ts').applyDefinitions}} */ ({ ...snapshot, ...normalization, ...analysis, ...validation, ...hashing, ...definitions });
  } catch (error) {
    throw new Error('CraftAtlas APIs unavailable; run git submodule update --init projects/craft-atlas and npm ci --ignore-scripts', { cause: error });
  }
}

/** @param {unknown} value @returns {SurvivalConfig} */
export function validateConfig(value) {
  if (!check(value)) throw new Error(`Survival configuration: ${ajv.errorsText(check.errors)}`);
  const config = /** @type {SurvivalConfig} */ (value);
  if (config.captureFiles && !config.captureRuntime) throw new Error('captureFiles requires a fresh captureRuntime');
  if (new Set(config.externalSources.map(s => s.kind)).size !== config.externalSources.length) throw new Error('Duplicate external source survey');
  if (new Set(config.mechanisms?.map(m => m.id)).size !== (config.mechanisms?.length ?? 0)) throw new Error('Duplicate acquisition mechanism ID');
  if (config.cases && new Set(config.cases.map(c => c.id)).size !== config.cases.length) throw new Error('Duplicate survival case ID');
  if (config.providers.some(p => !externalKinds.includes(p.kind))) throw new Error('Unknown provider kind');
  // Inventory is a starting assumption, never implicit proof of survival acquisition.
  for (const [resource, amount] of Object.entries(config.scenario.inventory ?? {})) {
    if (amount > 0 && !config.providers.some(p => p.resource === resource && p.availability === 'available')) throw new Error(`Inventory seed needs an available evidence-backed provider: ${resource}`);
  }
  return config;
}

/** Run a saved real capture or fixture through Atlas normalization and least fixed point analysis.
 * @param {Awaited<ReturnType<typeof loadAtlas>>} atlas
 * @param {Snapshot} snapshot
 * @param {SurvivalConfig} input
 * @param {{mod?:string,items?:string[],requireIdentity?:boolean,captureUnsupported?:string,expectation?:import('../../src/core/capture-identity.js').CaptureExpectation}} [selection]
 * @param {DefinitionPack[]} [packs]
 */
export function evaluateSurvival(atlas, snapshot, input, selection = {}, packs = []) {
  const config = validateConfig(input);
  const scenario = structuredClone(atlas.validate('scenario', config.scenario));
  if ((config.definitions?.length ?? 0) !== packs.length) throw new Error('Configured definitions must all be loaded before analysis');
  if (packs.length && atlas.definitionContractVersion !== 2) throw new Error('CraftAtlas definition contract v2 required; use a reviewed upgraded gitlink or explicit --atlas-source for local development');
  for (const pack of packs) {
    atlas.validate('definitions', pack);
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(pack.id) || !pack.verified.length || !pack.targets.mods.length) throw new Error('Mod definitions need a namespaced ID, exact Mod targets and verification evidence');
  }
  const originalModel = atlas.normalize(snapshot);
  const model = packs.length ? atlas.applyDefinitions(originalModel, packs, snapshot) : originalModel;
  const knownItems = new Set(snapshot.resources.filter(r => r.kind === 'item').map(r => r.id));
  const mod = selection.mod ?? config.mod;
  const selected = selection.items ?? config.items;
  if (mod && !snapshot.mods.some(m => m.id === mod)) throw new Error(`Selected Mod absent from snapshot: ${mod}`);
  /** @type {NonNullable<SurvivalConfig['cases']>} */
  const candidates = config.cases ?? [...knownItems].sort().map(item => ({ id: `survival:${item}`, item, expected: /** @type {const} */ ('reachable') }));
  const cases = candidates.filter(c => (!mod || c.item.startsWith(`${mod}:`)) && (!selected || selected.includes(c.item)));
  if (!cases.length) throw new Error('No survival cases selected; check Mod/item selectors');
  if (selected?.some(item => !cases.some(c => c.item === item))) throw new Error('Selected item has no case or is outside the Mod filter');
  for (const c of cases) if (!knownItems.has(c.item)) throw new Error(`Target item absent from captured registry: ${c.item}`);
  for (const p of config.providers) {
    if (!knownItems.has(p.resource)) throw new Error(`Provider resource absent from captured registry: ${p.resource}`);
    if (p.availability === 'available') scenario.inventory[p.resource] = Math.max(scenario.inventory[p.resource] ?? 0, 1);
  }
  /** @type {string[]} */
  const incomplete = [];
  const identity = selection.requireIdentity ? verifyCaptureIdentity(snapshot, selection.expectation) : undefined;
  if (identity && identity.status !== 'passed') incomplete.push(...identity.reasons);
  if (selection.captureUnsupported) incomplete.push(selection.captureUnsupported);
  if (snapshot.minecraft !== config.target.minecraft || snapshot.loader !== config.target.loader) throw new Error('Snapshot Minecraft/loader does not match configured target');
  if (!supportedTargets.includes(`${snapshot.loader}:${snapshot.minecraft}`)) incomplete.push(`Unsupported Atlas/Foundry target: ${snapshot.loader} ${snapshot.minecraft}; supported: Fabric/NeoForge 1.21.1, Forge/Fabric 1.20.1`);
  if (snapshot.recipes.some(r => r.error || r.serialization?.error || r.data === null)) incomplete.push('Recipe capture contains failed or missing serialized records; network bytes alone and definitions cannot complete semantic capture');
  const observations = snapshot.world?.observations ?? [];
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw new Error('Invalid finite observation record');
    if (snapshot.minecraft === '1.20.1') atlas.validate('observation-1.20.1', observation);
    if (observation.session !== snapshot.session || observation.generation !== snapshot.generation || observation.environmentHash !== atlas.hash(snapshot.environment)) throw new Error('Stale finite observation session/generation/environment');
    if (snapshot.minecraft === '1.20.1' && (observation.minecraft !== snapshot.minecraft || observation.loader !== snapshot.loader || observation.loaderVersion !== snapshot.loaderVersion)) throw new Error('Finite observation does not match snapshot target');
  }
  if (observations.length) incomplete.push('Finite observations are partial samples; they cannot prove exhaustive coverage, absence, sustainable supply or survival progression');
  if (snapshot.completion.status !== 'complete' || snapshot.completion.errors.length) incomplete.push('Snapshot capture is incomplete');
  if (snapshot.datapack) {
    const rawCoverage = snapshot.coverage.filter(c => c.dataset === 'datapack');
    if (!rawCoverage.length || rawCoverage.some(c => c.status !== 'complete' || c.enumerated === null) || rawCoverage.reduce((total, c) => total + (c.enumerated ?? 0), 0) !== snapshot.datapack.resources.length) incomplete.push('Datapack capture coverage is incomplete or its denominator does not match captured resources; raw enumeration is not semantic proof');
  }
  if (!model.coverage.some(c => c.dataset === 'recipes' && c.status === 'complete' && c.enumerated !== null)) incomplete.push('No complete recipe acquisition coverage');
  const recipeCoverage = snapshot.coverage.filter(c => c.dataset === 'recipes');
  const wildcard = recipeCoverage.find(c => c.type === '*');
  if (wildcard ? wildcard.enumerated !== snapshot.recipes.length : recipeCoverage.reduce((total, c) => total + (c.enumerated ?? 0), 0) !== snapshot.recipes.length || snapshot.recipes.some(r => !recipeCoverage.some(c => c.type === r.type))) incomplete.push('Recipe coverage denominator does not match the captured recipes');
  for (const c of model.coverage) if (c.status !== 'complete' || c.enumerated === null || c.dataset === 'normalization' && (c.interpreted === null || c.interpreted !== c.enumerated)) incomplete.push(`Incomplete ${c.dataset}/${c.type}: ${c.status}; ${c.reasons.join('; ')}`);
  for (const kind of externalKinds) {
    const survey = config.externalSources.find(s => s.kind === kind);
    if (!survey || survey.status !== 'complete') incomplete.push(`External source coverage ${kind}: ${survey?.status ?? 'not supplied'}`);
  }
  for (const p of config.providers) if (p.availability === 'unknown') incomplete.push(`Unconfirmed ${p.kind} provider for ${p.resource}: ${p.evidence}`);
  // Never let an external survey silently complete missing capture/normalizer coverage.
  // Opening the scenario prevents Atlas from reporting impossible paths on incomplete input.
  if (incomplete.length) { scenario.closed = false; scenario.closedResources = []; }
  const development = acquisitionDiagnostics(model, config);
  incomplete.push(...development.map(d => d.message));
  if (development.length) { scenario.closed = false; scenario.closedResources = []; }
  const details = cases.map(c => {
    const caseScenario = structuredClone(scenario);
    for (const id of c.without ?? []) {
      delete caseScenario.inventory[id];
      for (const key of /** @type {const} */ (['equipment', 'stages', 'dimensions'])) caseScenario[key] = caseScenario[key].filter((/** @type {string} */ value) => value !== id);
    }
    const analysis = atlas.analyze(model, caseScenario, c.item);
    const status = identity?.status === 'failed' ? 'failed' : incomplete.length || analysis.status === 'unknown' ? 'unsupported' : analysis.status === c.expected ? 'passed' : 'failed';
    const providerEvidence = config.providers.filter(p => p.availability === 'available' && !c.without?.includes(p.resource) && analysis.path.includes(p.resource));
    return { ...c, status, analysis, providerEvidence, incompleteRef: '#/incomplete' };
  });
  const results = { schemaVersion: 1, cases: details.map(c => ({ id: c.id, status: c.status,
    message: survivalSummary(c, incomplete),
    diagnostics: { schemaVersion: 1, counts: { incomplete: incomplete.length, unknown: c.analysis.unknown.length, stopReasons: c.analysis.stopReasons.length } },
  })) };
  return { results, evidence: { schemaVersion: 2, diagnosticContractVersion: 1, captureIdentity: identity ? { contractVersion: 1, expected: selection.expectation ?? null, observed: /** @type {Snapshot & {runtimeIdentity?:unknown}} */ (snapshot).runtimeIdentity ?? null, ...identity } : null, environment: snapshot.environment, mods: snapshot.mods, incomplete, snapshotId: snapshot.id, snapshotHash: atlas.hash(snapshot), modelHash: model.contentHash, normalizerVersion: model.normalizerVersion, definitions: packs.map(pack => ({ id: pack.id, version: pack.version, hash: atlas.hash(pack) })), originalCoverage: originalModel.coverage, coverage: model.coverage, development, definitionDiagnostics: model.diagnostics.filter(d => d.rule.startsWith('definition-')),
    datapack: model.datapack ?? null,
    recipes: snapshot.recipes,
    viewer: snapshot.viewer ?? null,
    world: snapshot.world ?? null,
    observationProcesses: model.processes.filter(p => p.type === 'minecraft:observation'),
    sourceEvidence: model.evidence,
    resourceDiagnostics: model.diagnostics.filter(d => d.rule.startsWith('datapack-') || d.rule === 'recipe-resource-missing'),
    definitionProcesses: model.processes.filter(p => p.evidence.some(e => e.startsWith('definition:'))),
    configHash: atlas.hash(config), scenario, externalSources: config.externalSources, details, limitations: [...new Set(details.flatMap(c => c.analysis.limitations))] } };
}

/** @param {{item:string,expected:string,status:string,analysis:Analysis}} detail
 * @param {string[]} incomplete
 */
function survivalSummary(detail, incomplete) {
  const { analysis } = detail;
  // First two records in evidence order: no locale-dependent sorting or giant joins.
  const examples = (/** @type {string} */ label, /** @type {string[]} */ reasons) => {
    const shown = reasons.slice(0, 2).map(reason => summarizeText(reason, 160));
    return `${label}=${reasons.length}${shown.length ? ` [${shown.join(' | ')}]` : ''}; omitted=${Math.max(0, reasons.length - shown.length)}`;
  };
  const stops = analysis.stopReasons.slice(0, 2).map(r => `${summarizeText(r.kind, 40)} ${summarizeText(r.target, 80)}: ${summarizeText(r.message, 160)}`);
  const action = detail.status === 'unsupported' ? 'Review incomplete coverage and unknowns in detail; repair capture or review definitions/providers and regression cases.'
    : detail.status === 'failed' ? 'Inspect blocked prerequisites and expected acquisition in detail; review definitions/providers and rerun this case.'
      : 'Review the saved route and assumptions before using this result as acquisition evidence.';
  return summarizeText(`${summarizeText(detail.item, 120)}: expected ${detail.expected}, Atlas ${analysis.status}; ${examples('incomplete', incomplete)}; ${examples('unknown', analysis.unknown)}; stopReasons=${analysis.stopReasons.length}${stops.length ? ` [${stops.join(' | ')}]` : ''}; omitted=${Math.max(0, analysis.stopReasons.length - stops.length)}; Next: ${action}`, survivalSummaryLimit);
}

/** Explicit opt-in pack paths are relative to the suite, never auto-discovered from code.
 * @param {Awaited<ReturnType<typeof loadAtlas>>} atlas
 * @param {SurvivalConfig} config
 * @param {string} configFile
 * @returns {DefinitionPack[]}
 */
export function loadDefinitions(atlas, config, configFile) {
  if (config.definitions?.length && atlas.definitionContractVersion !== 2) throw new Error('CraftAtlas definition contract v2 required; use a reviewed upgraded gitlink or explicit --atlas-source for local development');
  return (config.definitions ?? []).map(path => atlas.validate('definitions', JSON.parse(readFileSync(resolve(dirname(configFile), path), 'utf8'))));
}

/** Actionable development checks, shared by suite verdicts and saved evidence.
 * @param {import('../../projects/craft-atlas/packages/core/src/types.ts').Model} model
 * @param {SurvivalConfig} config
 */
export function acquisitionDiagnostics(model, config) {
  /** @type {{rule:string,target:string,message:string}[]} */
  const diagnostics = [];
  const report = (/** @type {string} */ rule, /** @type {string} */ target, /** @type {string} */ message) => diagnostics.push({ rule, target, message });
  for (const d of model.diagnostics.filter(d => d.rule === 'datapack-resource-error' || d.rule === 'datapack-runtime-conflict')) report(d.rule, d.target, `${d.message}; inspect effective bytes, override stack and runtime entry; repair capture or review the unresolved source/runtime conflict`);
  for (const d of model.diagnostics.filter(d => d.rule === 'recipe-resource-missing')) {
    const p = model.processes.find(p => p.id === d.target);
    // Runtime-only entries need explicit execution review, not a guessed source JSON.
    if (!p?.fieldEvidence.execution?.some(e => e.startsWith('definition:')) || p.execution !== 'executable') report('runtime-acquisition-review', d.target, `${d.message}; review the runtime API and explicitly define execution with mechanism and regression cases`);
  }
  for (const c of model.coverage.filter(c => c.dataset === 'datapackInterpretation' && c.status !== 'complete')) report('raw-acquisition-review', c.type, 'Custom-directory resources are raw evidence only; review the custom API and author explicit definition additions and regression cases; raw coverage and external surveys cannot close this scope');
  for (const d of model.diagnostics.filter(d => d.rule.startsWith('definition-') && !['definition-runtime-contradiction'].includes(d.rule))) report(d.rule, d.target, `${d.message}; fix the selected definition pack and add/update regression cases`);
  for (const p of model.processes.filter(p => p.interpretation === 'opaque' && p.enabled && p.type !== 'minecraft:observation')) report('unmapped-acquisition', p.id, `Unsupported serializer/source ${p.type} (${p.id}); add an evidence-backed definition and mechanism, or retain unknown with a reason; add/update positive and missing-input tests`);
  for (const p of model.processes.filter(p => p.evidence.some(e => e.startsWith('definition:')))) {
    if (!(config.mechanisms ?? []).some(m => m.processes.includes(p.id))) report('undeclared-acquisition', p.id, `Definition process ${p.id} needs a mechanisms entry and regression cases`);
  }
  for (const mechanism of config.mechanisms ?? []) {
    if (!model.mods.some(mod => mod.id === mechanism.mod)) report('acquisition-mod-missing', mechanism.id, `Mechanism Mod ${mechanism.mod} is absent`);
    if (!mechanism.id.startsWith(`${mechanism.mod}:`)) report('acquisition-namespace', mechanism.id, 'Mechanism ID must belong to its declared Mod namespace');
    if (mechanism.unknown) report('unknown-acquisition', mechanism.id, `Unverified acquisition ${mechanism.id}: ${mechanism.unknown}; keep coverage partial/unsupported and add/update tests`);
    const processes = mechanism.processes.map(id => model.processes.find(p => p.id === id));
    if (processes.some(p => !p)) report('acquisition-process-missing', mechanism.id, `Missing process mapping for ${mechanism.id}; add/update definitions and tests`);
    const outputs = processes.flatMap(p => p?.outputs.map(o => o.resource) ?? []);
    const tests = (config.cases ?? []).filter(c => outputs.includes(c.item));
    if (!tests.some(c => c.expected === 'reachable') || !tests.some(c => c.expected === 'unreachable' && c.without?.length)) report('acquisition-tests-missing', mechanism.id, `Mechanism ${mechanism.id} needs positive and without-prerequisite regression cases; do not use an unconditional provider for a transformation`);
  }
  return diagnostics;
}
