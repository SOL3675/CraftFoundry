import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadAtlas, validateConfig, evaluateSurvival, loadDefinitions } from './lib/atlas-survival.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
/** @type {Record<string,string>} */
const options = {};
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--harness' && !options['--harness']) { options['--harness'] = 'true'; continue; }
    const key = args[i], value = args[i + 1];
    if (!['--config', '--results', '--mod', '--items', '--atlas-source'].includes(key) || !value || value.startsWith('--') || options[key]) throw new Error('Usage: node scripts/atlas-survival.mjs --config <json> --results <results.json> [--mod <namespace>] [--items <id,id>] [--harness] [--atlas-source <local-development-checkout>]');
    options[key] = value;
    i++;
  }
  if (!options['--config'] || !options['--results']) throw new Error('--config and --results are required');
  const configFile = resolve(options['--config']);
  const output = resolve(options['--results']);
  if (configFile === output || configFile === output + '.evidence.json') throw new Error('Results must not overwrite configuration');
  const config = validateConfig(JSON.parse(readFileSync(configFile, 'utf8')));
  const localSource = options['--atlas-source'];
  const protectedFiles = [configFile, resolve(dirname(configFile), config.snapshot), ...(config.definitions ?? []).map(path => resolve(dirname(configFile), path))];
  if (protectedFiles.some(path => path === output || path === output + '.evidence.json')) throw new Error('Results must not overwrite a snapshot or definition');
  rmSync(output, { force: true }); rmSync(output + '.evidence.json', { force: true });
  const atlasRoot = localSource ? resolve(localSource) : resolve(root, 'projects/craft-atlas');
  const atlasCommit = execFileSync('git', ['-C', atlasRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const gitlink = execFileSync('git', ['-C', root, 'ls-files', '--stage', 'projects/craft-atlas'], { encoding: 'utf8' });
  if (!localSource && !gitlink.startsWith(`160000 ${atlasCommit} 0\t`)) throw new Error('Atlas checkout differs from the recorded gitlink; restore the pinned submodule');
  if (execFileSync('git', ['-C', atlasRoot, 'status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim()) throw new Error('Atlas checkout has source changes; restore a clean pinned submodule');
  const atlas = await loadAtlas(root, localSource ? atlasRoot : undefined);
  const packs = loadDefinitions(atlas, config, configFile);
  const snapshot = atlas.readSnapshot(resolve(dirname(configFile), config.snapshot));
  if (process.env.MCH_TARGET && process.env.MCH_PROJECT_ROOT) {
    const harness = JSON.parse(readFileSync(resolve(process.env.MCH_PROJECT_ROOT, 'harness.config.json'), 'utf8'));
    const target = harness.targets?.[process.env.MCH_TARGET];
    if (!target || target.minecraft !== snapshot.minecraft || target.loader !== snapshot.loader || target.loaderVersion && target.loaderVersion !== snapshot.loaderVersion) throw new Error('Snapshot does not match the active harness target');
  }
  const { results, evidence } = evaluateSurvival(atlas, snapshot, config, { mod: options['--mod'], items: options['--items']?.split(',') }, packs);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output + '.evidence.json', JSON.stringify({ ...evidence, atlasCommit, atlasSource: localSource ? 'explicit-local-development' : 'pinned-submodule' }, null, 2) + '\n');
  writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ results: output, cases: results.cases.length, atlasCommit }));
  // The process driver reads cases only after a successful transport exit.
  // In harness mode the required-suite evaluator owns the validation verdict.
  process.exitCode = options['--harness'] || results.cases.every(c => c.status === 'passed') ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
