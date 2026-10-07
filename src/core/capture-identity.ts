import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertContainedPath } from './paths.js';
import { sha256File } from './cache.js';
import type { Artifact } from './types.js';

export const captureIdentityContractVersion = 1;
export const captureInputRoots = ['mods', 'config', 'defaultconfigs', 'kubejs', 'scripts', 'world/serverconfig', 'world/datapacks', 'server.properties'] as const;
export interface CaptureExpectation {
  schemaVersion: 1; target: { minecraft: string; loader: string; loaderVersion: string };
  launchNonce: string; requestId: string; session: string; generation: number;
  artifacts: { path: string; sha256: string; kind: string }[];
  inputs: Record<string, string>;
  jvmProperties: Record<string, string>;
}
export function identityHash(value: unknown): string {
  const canonical = (v: any): string => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object'
    ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
  return createHash('sha256').update(canonical(value)).digest('hex');
}
/** Independently hash the prepared runtime's complete relevant file inventory; never take expected hashes from a dump. */
export async function captureInputs(directory: string): Promise<Record<string, string>> {
  const inputs: Record<string, string> = {};
  const visit = async (file: string) => {
    await assertContainedPath(directory, file);
    let info;
    try { info = await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error('Capture identity cannot follow runtime input symlinks');
    if (info.isDirectory()) { for (const entry of (await readdir(file)).sort()) await visit(path.join(file, entry)); }
    else if (info.isFile()) inputs[path.relative(directory, file).split(path.sep).join('/')] = await sha256File(file);
    else throw new Error('Capture input is not a regular file or directory');
  };
  for (const root of captureInputRoots) await visit(path.join(directory, root));
  return inputs;
}
export async function armCaptureLaunch(directory: string, jvmProperties: Record<string, string> = {}): Promise<string> {
  const launchNonce = randomUUID();
  await writeFile(path.join(directory, '.craftatlas-launch.json'), JSON.stringify({ schemaVersion: 1, launchNonce, propertyKeys: Object.keys(jvmProperties).sort() }), { flag: 'wx' });
  return launchNonce;
}
export async function createCaptureExpectation(directory: string, runRoot: string, artifacts: Artifact[], target: CaptureExpectation['target'],
  live: { session: string; generation: number }, requestId: string, jvmProperties: Record<string, string> = {}): Promise<CaptureExpectation> {
  const launch = JSON.parse(await readFile(path.join(directory, '.craftatlas-launch.json'), 'utf8'));
  if (launch.schemaVersion !== 1 || !launch.launchNonce) throw new Error('Missing launcher-issued capture nonce');
  const selected = artifacts.filter(a => ['distribution', 'runtime-dependency'].includes(a.kind) && ['both', 'server'].includes(a.side));
  if (!selected.some(a => a.kind === 'distribution')) throw new Error('No recorded server distribution for capture expectation');
  const inputs = await captureInputs(directory);
  const expected: CaptureExpectation['artifacts'] = [];
  for (const artifact of selected) {
    await assertContainedPath(runRoot, path.join(runRoot, artifact.path));
    const name = `mods/${path.basename(artifact.path)}`;
    if (await sha256File(path.join(runRoot, artifact.path)) !== artifact.sha256 || inputs[name] !== artifact.sha256) throw new Error(`Capture artifact mismatch: ${name}; rebuild and redeploy the exact recorded distribution/dependency`);
    if (expected.some(a => a.path === name)) throw new Error('Duplicate deployed artifact basename');
    expected.push({ path: name, sha256: artifact.sha256, kind: artifact.kind });
  }
  if (Object.keys(inputs).filter(p => p.startsWith('mods/')).some(p => !expected.some(a => a.path === p))) throw new Error('Unrecorded dependency in capture mods directory; declare it as a runtime-dependency artifact');
  if (identityHash(launch.propertyKeys ?? []) !== identityHash(Object.keys(jvmProperties).sort())) throw new Error('Capture JVM property scope differs from launch; restart with the declared property keys');
  const value: CaptureExpectation = { schemaVersion: 1, target, launchNonce: launch.launchNonce, requestId, ...live, artifacts: expected, inputs, jvmProperties };
  validateCaptureExpectation(value);
  return value;
}
export function validateCaptureExpectation(value: any): asserts value is CaptureExpectation {
  const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  if (!value || value.schemaVersion !== 1 || !value.target || !['minecraft', 'loader', 'loaderVersion'].every(k => typeof value.target[k] === 'string' && value.target[k])
    || !/^[a-f0-9-]{36}$/.test(value.launchNonce) || !/^[A-Za-z0-9_-]{1,80}$/.test(value.requestId) || typeof value.session !== 'string' || !value.session
    || !Number.isSafeInteger(value.generation) || value.generation < 0 || !value.inputs || Array.isArray(value.inputs)
    || !Object.entries(value.inputs).every(([p, h]) => captureInputRoots.some(root => p === root || p.startsWith(root + '/')) && !p.split('/').some(x => ['', '.', '..'].includes(x)) && !p.includes('\\') && digest(h))
    || !Array.isArray(value.artifacts) || !value.artifacts.length || !value.artifacts.some((a: any) => a.kind === 'distribution')
    || value.artifacts.some((a: any) => !a.path?.startsWith('mods/') || !digest(a.sha256) || !['distribution', 'runtime-dependency'].includes(a.kind) || value.inputs[a.path] !== a.sha256)
    || new Set(value.artifacts.map((a: any) => a.path)).size !== value.artifacts.length
    || !value.jvmProperties || Array.isArray(value.jvmProperties) || !Object.values(value.jvmProperties).every(v => typeof v === 'string')) throw new Error('Invalid capture expectation v1; generate it from the current recorded build and fresh owned runtime');
}
/** Missing identity is unsupported; measured mismatches are failures. Legacy read/analysis APIs stay compatible. */
export function verifyCaptureIdentity(snapshot: any, expectation?: CaptureExpectation): { status: 'passed' | 'failed' | 'unsupported'; reasons: string[] } {
  if (!expectation) return { status: 'unsupported', reasons: ['Missing trusted expected build/capture manifest; collect a fresh capture from the current Run'] };
  validateCaptureExpectation(expectation);
  const observed = snapshot?.runtimeIdentity;
  if (!observed || observed.schemaVersion !== 1 || observed.status !== 'complete') return { status: 'unsupported', reasons: ['Missing or unverifiable runtime capture identity v1; upgrade the collector and launch a fresh owned session', ...(Array.isArray(observed?.errors) ? observed.errors.filter((v: unknown) => typeof v === 'string') : [])] };
  const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!observed.inputs || typeof observed.inputs !== 'object' || Array.isArray(observed.inputs) || !Object.values(observed.inputs).every(digest)
    || !Array.isArray(observed.loadedJars) || !observed.loadedJars.every((j: any) => j && typeof j.name === 'string' && digest(j.sha256))
    || ![observed.startupJarsHash, observed.startupInputsHash, observed.startupConfigurationHash, observed.startupPropertiesHash].every(digest)
    || !Array.isArray(observed.errors) || observed.errors.length) return { status: 'unsupported', reasons: ['Malformed or incomplete measured runtime identity; retain raw evidence, repair the collector and recapture'] };
  const reasons: string[] = [];
  if (identityHash(observed.inputs) !== observed.startupInputsHash) reasons.push('Runtime input inventory was not measured unchanged from startup; fully restart with the intended config/datapack/script inputs and recapture');
  for (const key of ['minecraft', 'loader', 'loaderVersion']) if (snapshot[key] !== expectation.target[key as keyof CaptureExpectation['target']]) reasons.push(`Capture target ${key} changed`);
  for (const key of ['launchNonce', 'requestId', 'session', 'generation'] as const) if (observed[key] !== expectation[key] || (key === 'session' || key === 'generation') && snapshot[key] !== expectation[key]) reasons.push(`Capture ${key} mismatch; rerun capture in the current live session/generation`);
  if (!observed.jvmProperties || identityHash(observed.jvmProperties) !== identityHash(expectation.jvmProperties)) reasons.push('Declared game JVM properties changed/missing; restore the runtime configuration and fully restart before capture');
  if (!observed.inputs || identityHash(observed.inputs) !== identityHash(expectation.inputs)) {
    const keys = new Set([...Object.keys(expectation.inputs), ...Object.keys(observed.inputs ?? {})]);
    for (const key of keys) if (expectation.inputs[key] !== observed.inputs?.[key]) reasons.push(`Runtime input changed/missing: ${key}; restore the expected JAR/dependency/config/datapack and recapture`);
  }
  if (!Array.isArray(observed.loadedJars) || !observed.loadedJars.length || !observed.startupJarsHash || identityHash(observed.loadedJars) !== observed.startupJarsHash) reasons.push('Loaded JAR origins changed after startup or are missing; fully restart the server');
  const configuration = Object.fromEntries(Object.entries(observed.inputs).filter(([key]) => key === 'server.properties' || ['config/', 'defaultconfigs/', 'world/serverconfig/'].some(root => key.startsWith(root))));
  if (identityHash(configuration) !== observed.startupConfigurationHash || identityHash(observed.jvmProperties) !== observed.startupPropertiesHash) reasons.push('Configuration/JVM properties were not measured unchanged from startup; fully restart and recapture applied inputs');
  for (const artifact of expectation.artifacts) if (!observed.loadedJars?.some((j: any) => j.sha256 === artifact.sha256)) reasons.push(`Recorded artifact was not measured at a loaded mod origin: ${artifact.path}; deploy the distribution and fully restart`);
  return { status: reasons.length ? 'failed' : 'passed', reasons };
}
