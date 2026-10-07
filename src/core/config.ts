import { readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import type { ArtifactManifest, HarnessConfig, HarnessLock, LoadedConfig, LocalConfig } from './types.js';

export class ConfigError extends Error {
  readonly code = 'CONFIG_INVALID';
  readonly diagnostics: string[];

  constructor(diagnostics: string[]) {
    super(`Invalid harness configuration:\n${diagnostics.map((line) => `- ${line}`).join('\n')}`);
    this.name = 'ConfigError';
    this.diagnostics = diagnostics;
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
function schema<T>(filename: string): ValidateFunction<T> {
  return ajv.compile<T>(JSON.parse(readFileSync(new URL(`../../schemas/${filename}`, import.meta.url), 'utf8')));
}
const validateShared = schema<HarnessConfig>('harness.config.schema.json');
const validateLocal = schema<LocalConfig>('harness.local.schema.json');
const validateLock = schema<HarnessLock>('harness.lock.schema.json');
const validateManifest = schema<ArtifactManifest>('artifact-manifest.schema.json');

function checked<T>(value: unknown, validator: ValidateFunction<T>, filename: string): T {
  if (!validator(value)) {
    throw new ConfigError((validator.errors ?? []).map((error) => {
      const detail = error.keyword === 'additionalProperties' ? `: ${String(error.params.additionalProperty)}` :
        error.keyword === 'required' ? `: ${String(error.params.missingProperty)}` : '';
      return `${filename}${error.instancePath || '/'} ${error.message ?? error.keyword}${detail}`;
    }));
  }
  return value;
}

function checkId(id: string, location: string, diagnostics: string[]): void {
  if (['__proto__', 'constructor', 'prototype'].includes(id) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(id) || /[. ]$/.test(id)) {
    diagnostics.push(`${location}: identifier ${JSON.stringify(id)} is reserved or unsafe on Windows`);
  }
}

/** Both path syntaxes are checked, so Linux cannot admit a Windows traversal. */
function checkRelative(value: string, location: string, diagnostics: string[], allowDot = false): void {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value) ||
      value.includes('\0') || value.includes(':') || /[<>"|?*]/.test(value) ||
      value.split(/[\\/]/).some((segment) => segment === '..' || /[. ]$/.test(segment) && segment !== '.' ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment)) ||
      (!allowDot && value.split(/[\\/]/).every((segment) => segment === '.' || segment === ''))) {
    diagnostics.push(`${location}: must be a safe relative path inside its root (received ${JSON.stringify(value)})`);
  }
}

function checkMinecraft(version: string, location: string, diagnostics: string[]): void {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (major < 1 || major === 1 && (minor < 20 || minor === 20 && patch < 1)) {
    diagnostics.push(`${location}: Minecraft ${version} is below the supported lower bound 1.20.1`);
  }
}

async function readJson(root: string, filename: string, fallback?: unknown): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(path.join(root, filename), 'utf8');
  } catch (error) {
    if (fallback !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new ConfigError([`${filename}: cannot read file (${(error as Error).message})`]);
  }
  try { return JSON.parse(contents); }
  catch (error) { throw new ConfigError([`${filename}: invalid JSON (${(error as Error).message})`]); }
}

function isWithin(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function checkBuildRoot(root: string, value: string, location: string, diagnostics: string[]): Promise<void> {
  // Inspect the nearest existing parent too, so a missing directory below an escaping symlink is rejected.
  let candidate = path.resolve(root, value);
  while (true) {
    try {
      const actual = await realpath(candidate);
      if (!isWithin(root, actual)) diagnostics.push(`${location}: resolved path escapes the project root`);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        diagnostics.push(`${location}: cannot resolve path (${(error as Error).message})`);
        return;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) return;
      candidate = parent;
    }
  }
}

export async function loadConfig(projectRoot: string): Promise<LoadedConfig> {
  let root: string;
  try { root = await realpath(path.resolve(projectRoot)); }
  catch (error) { throw new ConfigError([`project root: cannot resolve ${projectRoot} (${(error as Error).message})`]); }
  const [sharedValue, localValue, lockValue] = await Promise.all([
    readJson(root, 'harness.config.json'), readJson(root, 'harness.local.json', { schemaVersion: 1 }),
    readJson(root, 'harness.lock.json', { schemaVersion: 1, tools: {} }),
  ]);
  const config = checked(sharedValue, validateShared, 'harness.config.json');
  const local = checked(localValue, validateLocal, 'harness.local.json');
  const lock = checked(lockValue, validateLock, 'harness.lock.json');
  const diagnostics: string[] = [];
  if (local.assetCache && (!(path.win32.isAbsolute(local.assetCache) || path.posix.isAbsolute(local.assetCache)) || local.assetCache.includes('\0'))) diagnostics.push('harness.local.json/assetCache: asset cache path must be absolute');
  for (const [version, value] of Object.entries(local.assetCaches ?? {})) {
    if (!(path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) || value.includes('\0')) diagnostics.push(`harness.local.json/assetCaches/${version}: asset cache path must be absolute`);
  }
  checkId(config.projectId, 'projectId', diagnostics);
  for (const [id, build] of Object.entries(config.builds)) {
    checkId(id, `builds/${id}`, diagnostics);
    checkRelative(build.root, `builds/${id}/root`, diagnostics, true);
    await checkBuildRoot(root, build.root, `builds/${id}/root`, diagnostics);
  }
  for (const [id, target] of Object.entries(config.targets)) {
    checkId(id, `targets/${id}`, diagnostics);
    checkMinecraft(target.minecraft, `targets/${id}/minecraft`, diagnostics);
    checkRelative(target.artifactManifest, `targets/${id}/artifactManifest`, diagnostics);
    if (!Object.hasOwn(config.builds, target.build)) diagnostics.push(`targets/${id}/build: unknown build ${target.build}`);
    for (const [taskKey, tasks] of Object.entries(target.tasks)) {
      checkId(taskKey, `targets/${id}/tasks/${taskKey}`, diagnostics);
      if (tasks.some((task) => task.startsWith('-'))) diagnostics.push(`targets/${id}/tasks/${taskKey}: Gradle tasks cannot be command-line options`);
    }
    for (const suiteId of target.requiredSuites) {
      const suite = Object.hasOwn(config.suites, suiteId) ? config.suites[suiteId] : undefined;
      if (!suite) diagnostics.push(`targets/${id}/requiredSuites: unknown suite ${suiteId}`);
      else if (suite.driver === 'gradle' && suite.task && !Object.hasOwn(target.tasks, suite.task)) {
        diagnostics.push(`targets/${id}/requiredSuites: suite ${suiteId} refers to missing task mapping ${suite.task}`);
      }
    }
    if (target.caseAliases && new Set(Object.values(target.caseAliases)).size !== Object.values(target.caseAliases).length) diagnostics.push(`targets/${id}/caseAliases: canonical case IDs must be unique`);
    for (const [suiteId, binding] of Object.entries(target.suiteBindings ?? {})) {
      if (!Object.hasOwn(config.suites, suiteId)) diagnostics.push(`targets/${id}/suiteBindings/${suiteId}: unknown suite`);
      if (binding.runtime && !Object.hasOwn(config.runtimes, binding.runtime)) diagnostics.push(`targets/${id}/suiteBindings/${suiteId}: unknown runtime ${binding.runtime}`);
      for (const tool of binding.pilot ? [binding.pilot.backend, binding.pilot.helper] : []) if (!Object.hasOwn(lock.tools, tool)) diagnostics.push(`targets/${id}/suiteBindings/${suiteId}: tool ${tool} must be pinned in harness.lock.json`);
    }
  }
  for (const [id, suite] of Object.entries(config.suites)) {
    checkId(id, `suites/${id}`, diagnostics);
    if (suite.driver === 'gradle' && !suite.task) diagnostics.push(`suites/${id}/task: a Gradle suite needs a task mapping key`);
    if (['process', 'server-smoke', 'server-persistence', 'client-smoke', 'fixture-multiplayer', 'fixture-multi-client'].includes(suite.driver) && !suite.runtime) diagnostics.push(`suites/${id}/runtime: a process suite needs a runtime reference`);
    if (['client-smoke', 'fixture-multiplayer', 'fixture-multi-client'].includes(suite.driver) && !suite.pilot) diagnostics.push(`suites/${id}/pilot: a pilot backend and helper must be declared`);
    if (suite.pilot) {
      for (const tool of [suite.pilot.backend, suite.pilot.helper]) if (!Object.hasOwn(lock.tools, tool)) diagnostics.push(`suites/${id}/pilot: tool ${tool} must be pinned in harness.lock.json`);
    }
    if (suite.runtime && !Object.hasOwn(config.runtimes, suite.runtime)) diagnostics.push(`suites/${id}/runtime: unknown runtime ${suite.runtime}`);
    if (suite.driver === 'server-persistence' && !suite.persistence) diagnostics.push(`suites/${id}: persistence probes required`);
    if (suite.persistence) {
      if (suite.driver !== 'server-persistence') diagnostics.push(`suites/${id}: persistence probes require server-persistence driver`);
      if (new Set(suite.persistence.assertions.map(a => a.id)).size !== suite.persistence.assertions.length) diagnostics.push(`suites/${id}: duplicate restoration assertion ID`);
      for (const probe of [...suite.persistence.seed, ...suite.persistence.assertions]) {
        try { new RegExp(probe.pattern.replaceAll('{nonce}', 'probe')); } catch { diagnostics.push(`suites/${id}: invalid persistence pattern`); }
        if (probe.failurePattern) try { new RegExp(probe.failurePattern.replaceAll('{nonce}', 'probe')); } catch { diagnostics.push(`suites/${id}: invalid persistence failure pattern`); }
      }
    }
    if (suite.results) checkRelative(suite.results, `suites/${id}/results`, diagnostics);
  }
  for (const [id, runtime] of Object.entries(config.runtimes)) {
    checkId(id, `runtimes/${id}`, diagnostics);
    if (runtime.readyPattern) {
      try { new RegExp(runtime.readyPattern); }
      catch (error) { diagnostics.push(`runtimes/${id}/readyPattern: invalid regular expression (${(error as Error).message})`); }
    }
  }
  for (const [id, javaPath] of Object.entries(local.java ?? {})) {
    checkId(id, `harness.local.json/java/${id}`, diagnostics);
    if (!(path.win32.isAbsolute(javaPath) || path.posix.isAbsolute(javaPath)) || javaPath.includes('\0')) {
      diagnostics.push(`harness.local.json/java/${id}: Java path must be absolute`);
    }
  }
  for (const [id, toolPath] of Object.entries(local.tools ?? {})) {
    checkId(id, `harness.local.json/tools/${id}`, diagnostics);
    if (!(path.win32.isAbsolute(toolPath) || path.posix.isAbsolute(toolPath)) || toolPath.includes('\0')) diagnostics.push(`harness.local.json/tools/${id}: tool path must be absolute`);
    if (!Object.hasOwn(lock.tools, id)) diagnostics.push(`harness.local.json/tools/${id}: tool must be pinned in harness.lock.json`);
  }
  for (const [id, backendPath] of Object.entries(local.backends ?? {})) {
    checkId(id, `harness.local.json/backends/${id}`, diagnostics);
    if (!(path.win32.isAbsolute(backendPath) || path.posix.isAbsolute(backendPath)) || backendPath.includes('\0')) diagnostics.push(`harness.local.json/backends/${id}: backend path must be absolute`);
    if (!Object.hasOwn(lock.tools, id)) diagnostics.push(`harness.local.json/backends/${id}: backend must be pinned in harness.lock.json`);
  }
  for (const id of Object.keys(lock.tools)) checkId(id, `harness.lock.json/tools/${id}`, diagnostics);
  if (diagnostics.length) throw new ConfigError(diagnostics);
  return { root, config, local, lock };
}

export function validateArtifactManifest(value: unknown): ArtifactManifest {
  const manifest = checked(value, validateManifest, 'artifact manifest');
  const diagnostics: string[] = [];
  checkId(manifest.target, 'artifact manifest/target', diagnostics);
  checkMinecraft(manifest.minecraft, 'artifact manifest/minecraft', diagnostics);
  const seen = new Set<string>();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    checkRelative(artifact.path, `artifact manifest/artifacts/${index}/path`, diagnostics);
    const normalized = artifact.path.replaceAll('\\', '/').split('/').filter((part) => part !== '.' && part !== '').join('/');
    if (seen.has(normalized)) diagnostics.push(`artifact manifest/artifacts/${index}/path: duplicate artifact ${artifact.path}`);
    seen.add(normalized);
  }
  // Resolved Gradle classpaths may point to dependency caches outside the project. They are inspection metadata,
  // never implicitly deployed; only artifacts use the contained relative path contract.
  for (const [name, paths] of [['classpath', manifest.classpath], ['sources', manifest.sources]] as const) {
    for (const entry of paths ?? []) if (entry.includes('\0')) diagnostics.push(`artifact manifest/${name}: path contains NUL`);
  }
  if (diagnostics.length) throw new ConfigError(diagnostics);
  return manifest;
}
