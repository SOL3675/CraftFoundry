import { readdir, readFile, mkdir, writeFile, lstat, cp } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { loadConfig } from '../../dist/core/config.js';
import { OwnedServer } from '../../dist/adapters/runtime/server.js';
import { armCaptureLaunch, createCaptureExpectation, verifyCaptureIdentity } from '../../dist/core/capture-identity.js';
import { sha256File } from '../../dist/core/cache.js';
import { assertContainedPath } from '../../dist/core/paths.js';

export class CaptureUnsupported extends Error {}

/** Fresh dedicated capture and complete retained raw provenance from this Run's actual built artifacts.
 * @param {Awaited<ReturnType<import('./atlas-survival.mjs').loadAtlas>>} atlas
 * @param {string} runtimeId
 * @param {string} projectRoot
 * @param {string|undefined} runRoot
 * @param {string} sessionRoot
 * @param {string|undefined} targetId
 * @param {{source:string,destination:string}[]} [captureFiles]
 */
export async function captureForSurvival(atlas, runtimeId, projectRoot, runRoot, sessionRoot, targetId, captureFiles = []) {
  if (!runRoot || !targetId) throw new Error('Fresh capture must run through mch test with the current Run and target');
  if (atlas.captureIdentityContractVersion !== 1) throw new CaptureUnsupported('CraftAtlas capture identity contract v1 required; use the reviewed collector/API update and a clean --atlas-source checkout until its reachable gitlink is delivered');
  const loaded = await loadConfig(projectRoot), target = loaded.config.targets[targetId], runtime = loaded.config.runtimes[runtimeId];
  if (!runtime || runtime.kind !== 'server' || !target?.loaderVersion) throw new Error('Fresh capture needs a configured dedicated runtime and exact target loaderVersion');
  const artifactRoot = join(runRoot, 'artifacts', targetId);
  const names = (await readdir(artifactRoot)).filter(f => /^artifacts-[a-f0-9]{64}\.json$/.test(f));
  if (names.length !== 1) throw new Error('Fresh capture requires exactly one current recorded build artifact set');
  const bytes = await readFile(join(artifactRoot, names[0]));
  if (`artifacts-${createHash('sha256').update(bytes).digest('hex')}.json` !== names[0]) throw new Error('Tampered build artifact manifest');
  const record = JSON.parse(bytes.toString());
  if (record.schemaVersion !== 1 || record.target !== targetId) throw new Error('Capture build target mismatch');
  const artifacts = record.artifacts.map((/** @type {import('../../src/core/types.js').Artifact} */ a) => {
    const file = resolve(artifactRoot, a.path), rel = relative(artifactRoot, file);
    if (rel.startsWith('..') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) throw new Error('Build artifact escapes recorded root');
    return { ...a, path: relative(runRoot, file) };
  });
  const directory = join(sessionRoot, 'capture-game');
  const server = new OwnedServer(loaded, targetId, runtime, directory, join(sessionRoot, 'capture-process-logs'));
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  let snapshot, expectation, verdict, clean = false;
  /** @type {{schemaVersion:1,files:{file:string,sha256:string}[]}} */
  const captureEvidence = { schemaVersion: 1, files: [] };
  try {
    await server.prepare(artifacts, runRoot, controller.signal);
    const checkSource = async (/** @type {string} */ file) => {
      await assertContainedPath(loaded.root, file);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('Capture input preparation cannot follow project symlinks');
      if (info.isDirectory()) for (const entry of await readdir(file)) await checkSource(join(file, entry));
      else if (!info.isFile()) throw new Error('Capture preparation source is not a regular file');
    };
    for (const file of captureFiles) {
      if (!/^(config|defaultconfigs|kubejs|scripts|world\/(datapacks|serverconfig))(\/[^\\]+)?$/.test(file.destination) || file.destination.split('/').some(p => ['.', '..', ''].includes(p))) throw new Error('Capture destination must be an owned config/script/datapack path');
      const source = resolve(loaded.root, file.source), destination = resolve(directory, file.destination);
      await checkSource(source); await assertContainedPath(directory, destination);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    }
    const jvmProperties = Object.fromEntries((runtime.command?.args ?? []).filter(a => a.startsWith('-D')).map(argument => {
      const value = argument.slice(2).replaceAll('{sessionRoot}', directory).replaceAll('{port}', String(server.port)).replaceAll('{os}', process.platform === 'win32' ? 'win' : 'unix');
      const index = value.indexOf('='); return index < 0 ? [value, ''] : [value.slice(0, index), value.slice(index + 1)];
    }));
    await armCaptureLaunch(directory, jvmProperties);
    await server.start(controller.signal); await server.waitReady();
    let mark = server.mark(); server.command('craftatlas status');
    const status = await server.waitForOutput(/CRAFTATLAS STATUS session=([a-f0-9-]+) generation=(\d+) status=ready/, loaded.local.timeouts?.start ?? 120_000, mark);
    const live = /session=([a-f0-9-]+) generation=(\d+)/.exec(status);
    if (!live) throw new Error('No live collector session/generation');
    const requestId = 'harness_' + randomUUID().replaceAll('-', '');
    expectation = await createCaptureExpectation(directory, runRoot, artifacts, { minecraft: target.minecraft, loader: target.loader, loaderVersion: target.loaderVersion }, { session: live[1], generation: Number(live[2]) }, requestId, jvmProperties);
    await writeFile(join(sessionRoot, 'capture-expectation.json'), JSON.stringify(expectation, null, 2), { flag: 'wx' });
    mark = server.mark(); server.command(`craftatlas dump ${requestId}`);
    await server.waitForOutput(new RegExp(`CRAFTATLAS COMPLETE label=${requestId} generation=${expectation.generation}(?: |$)`), loaded.local.timeouts?.test ?? 120_000, mark);
    snapshot = atlas.readSnapshot(join(directory, 'craftatlas', requestId));
    verdict = verifyCaptureIdentity(snapshot, expectation);
    await server.stopClean(); clean = true;
    return { snapshot, expectation, verdict, captureEvidence };
  } finally {
    try {
    await server.stop();
    if (server.ownsDirectory) await server.collectEvidence();
    await mkdir(sessionRoot, { recursive: true });
    await writeFile(join(sessionRoot, 'capture-lifecycle.json'), JSON.stringify({ schemaVersion: 1, target: targetId, cleanStop: clean, expectation, verdict }, null, 2));
    if (expectation) {
      for (const file of ['capture-expectation.json', 'capture-lifecycle.json', 'capture-game/.craftatlas-launch.json', 'capture-game/session.json', 'capture-game/server.properties']) {
        captureEvidence.files.push({ file, sha256: await sha256File(join(sessionRoot, file)) });
      }
      const rawDirectory = join(directory, 'craftatlas', expectation.requestId);
      const rawFiles = await readdir(rawDirectory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const file of rawFiles) captureEvidence.files.push({ file: relative(sessionRoot, join(rawDirectory, file)).replaceAll('\\', '/'), sha256: await sha256File(join(rawDirectory, file)) });
      for (const file of ['stdout.log', 'stderr.log']) captureEvidence.files.push({ file: `capture-process-logs/launch-1/${file}`, sha256: await sha256File(join(sessionRoot, 'capture-process-logs/launch-1', file)) });
    }
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
  }
}
