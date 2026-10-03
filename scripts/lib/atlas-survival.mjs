import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Ajv } from 'ajv';

/** @typedef {import('../../projects/craft-atlas/packages/core/src/types.ts').Snapshot} Snapshot */
/** @typedef {import('../../projects/craft-atlas/packages/core/src/types.ts').Scenario} Scenario */
/** @typedef {import('../../projects/craft-atlas/packages/core/src/analyze.ts').Analysis} Analysis */
/** @typedef {{resource:string, kind:string, availability:'available'|'unknown', evidence:string}} Provider */
/** @typedef {{kind:string, status:'complete'|'partial'|'unsupported', evidence:string}} Survey */
/** @typedef {{schemaVersion:1, snapshot:string, target:{minecraft:string,loader:string}, scenario:Scenario, providers:Provider[], externalSources:Survey[], mod?:string, items?:string[], cases?:{id:string,item:string,expected:'reachable'|'unreachable'}[]}} SurvivalConfig */

export const externalKinds = ['loot', 'drops', 'harvesting', 'worldgen', 'trades', 'other'];
const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(JSON.parse(readFileSync(new URL('../../schemas/atlas-survival.schema.json', import.meta.url), 'utf8')));

/** Load the pinned checkout's source APIs without installing Atlas or its Foundry consumer dependency.
 * Node 24 strips Atlas's TypeScript; its Ajv import resolves the root's identical locked version.
 * @param {string} root
 */
export async function loadAtlas(root) {
  const base = resolve(root, 'projects/craft-atlas/packages/core/src');
  try {
    const [snapshot, normalization, analysis, validation, hashing] = await Promise.all([
      import(pathToFileURL(resolve(base, 'snapshot.ts')).href),
      import(pathToFileURL(resolve(base, 'normalize.ts')).href),
      import(pathToFileURL(resolve(base, 'analyze.ts')).href),
      import(pathToFileURL(resolve(base, 'validate.ts')).href),
      import(pathToFileURL(resolve(base, 'hash.ts')).href),
    ]);
    return /** @type {{readSnapshot: (path:string)=>Snapshot, normalize: typeof import('../../projects/craft-atlas/packages/core/src/normalize.ts').normalize, analyze: typeof import('../../projects/craft-atlas/packages/core/src/analyze.ts').analyze, validate: typeof import('../../projects/craft-atlas/packages/core/src/validate.ts').validate, hash: (value:unknown)=>string}} */ ({ ...snapshot, ...normalization, ...analysis, ...validation, ...hashing });
  } catch (error) {
    throw new Error('CraftAtlas APIs unavailable; run git submodule update --init projects/craft-atlas and npm ci --ignore-scripts', { cause: error });
  }
}

/** @param {unknown} value @returns {SurvivalConfig} */
export function validateConfig(value) {
  if (!check(value)) throw new Error(`Survival configuration: ${ajv.errorsText(check.errors)}`);
  const config = /** @type {SurvivalConfig} */ (value);
  if (new Set(config.externalSources.map(s => s.kind)).size !== config.externalSources.length) throw new Error('Duplicate external source survey');
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
 * @param {{mod?:string,items?:string[]}} [selection]
 */
export function evaluateSurvival(atlas, snapshot, input, selection = {}) {
  const config = validateConfig(input);
  const scenario = structuredClone(atlas.validate('scenario', config.scenario));
  const model = atlas.normalize(snapshot);
  const knownItems = new Set(snapshot.resources.filter(r => r.kind === 'item').map(r => r.id));
  const mod = selection.mod ?? config.mod;
  const selected = selection.items ?? config.items;
  if (mod && !snapshot.mods.some(m => m.id === mod)) throw new Error(`Selected Mod absent from snapshot: ${mod}`);
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
  if (snapshot.minecraft !== config.target.minecraft || snapshot.loader !== config.target.loader) throw new Error('Snapshot Minecraft/loader does not match configured target');
  if (snapshot.minecraft !== '1.21.1' || !['fabric', 'neoforge'].includes(snapshot.loader)) incomplete.push(`Unsupported Atlas/Foundry target: ${snapshot.loader} ${snapshot.minecraft}; supported: Fabric/NeoForge 1.21.1`);
  if (snapshot.completion.status !== 'complete' || snapshot.completion.errors.length) incomplete.push('Snapshot capture is incomplete');
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
  const details = cases.map(c => {
    const analysis = atlas.analyze(model, scenario, c.item);
    const status = incomplete.length || analysis.status === 'unknown' ? 'unsupported' : analysis.status === c.expected ? 'passed' : 'failed';
    const providerEvidence = config.providers.filter(p => p.availability === 'available' && analysis.path.includes(p.resource));
    return { ...c, status, analysis, providerEvidence, incomplete };
  });
  const results = { schemaVersion: 1, cases: details.map(c => ({ id: c.id, status: c.status, message: `${c.item}: expected ${c.expected}, Atlas ${c.analysis.status}; ${[...c.incomplete, ...c.analysis.unknown, ...c.analysis.stopReasons.map(r => r.message)].join('; ')}` })) };
  return { results, evidence: { schemaVersion: 1, snapshotId: snapshot.id, snapshotHash: atlas.hash(snapshot), modelHash: model.contentHash, normalizerVersion: model.normalizerVersion, configHash: atlas.hash(config), scenario, externalSources: config.externalSources, details, limitations: [...new Set(details.flatMap(c => c.analysis.limitations))] } };
}
