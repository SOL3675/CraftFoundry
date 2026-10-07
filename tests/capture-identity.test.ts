import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { armCaptureLaunch, createCaptureExpectation, identityHash, verifyCaptureIdentity, captureInputs } from '../dist/core/capture-identity.js';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'foundry capture identity '));
  const directory = path.join(root, 'game'); await mkdir(path.join(directory, 'mods'), { recursive: true });
  const artifacts = ['mod.jar', 'dep.jar'].map((name, i) => ({ path: name, kind: i ? 'runtime-dependency' : 'distribution', side: 'both', sha256: digest(name), size: name.length, originalPath: name })) as any;
  for (const artifact of artifacts) { await writeFile(path.join(root, artifact.path), artifact.path); await writeFile(path.join(directory, 'mods', artifact.path), artifact.path); }
  for (const name of ['config/mod.json', 'world/datapacks/custom/data/mod/recipe/a.json', 'scripts/a.zs']) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await writeFile(path.join(directory, name), '{}');
  }
  await armCaptureLaunch(directory);
  const target = { minecraft: '1.21.1', loader: 'fabric', loaderVersion: '0.16.14' };
  const expected = await createCaptureExpectation(directory, root, artifacts, target, { session: 'live-session', generation: 2 }, 'fresh_capture');
  const loadedJars = artifacts.map((a: any) => ({ name: a.path, sha256: a.sha256 }));
  const snapshot = { ...target, session: expected.session, generation: expected.generation, runtimeIdentity: { schemaVersion: 1, status: 'complete', launchNonce: expected.launchNonce, requestId: expected.requestId, session: expected.session, generation: expected.generation, inputs: structuredClone(expected.inputs), loadedJars, startupJarsHash: identityHash(loadedJars), startupInputsHash: identityHash(expected.inputs), jvmProperties: {}, errors: [] } };
  Object.assign(snapshot.runtimeIdentity, {startupPropertiesHash:identityHash({}),startupConfigurationHash:identityHash(Object.fromEntries(Object.entries(expected.inputs).filter(([key])=>key==='server.properties'||['config/','defaultconfigs/','world/serverconfig/'].some(root=>key.startsWith(root))))) });
  return { root, directory, artifacts, expected, snapshot };
}
test('current build plus independently measured fresh capture passes for the four target identities', async () => {
  const c = await fixture();
  try {
    for (const [loader, minecraft, loaderVersion] of [['fabric','1.21.1','0.16.14'],['neoforge','1.21.1','21.1.252'],['forge','1.20.1','47.3.0'],['fabric','1.20.1','0.16.14']]) {
      c.expected.target = {loader,minecraft,loaderVersion}; Object.assign(c.snapshot, c.expected.target);
      assert.equal(verifyCaptureIdentity(c.snapshot, c.expected).status, 'passed');
    }
    assert.match(JSON.stringify(c.expected), /config\/mod.json/);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});
test('changed JAR, dependency, config, datapack, scripts and missing/unexpected files reject stale identity with actions', async () => {
  const c = await fixture();
  try {
    for (const key of Object.keys(c.expected.inputs)) {
      const snapshot = structuredClone(c.snapshot); snapshot.runtimeIdentity.inputs[key] = digest('changed');
      const verdict = verifyCaptureIdentity(snapshot, c.expected);
      assert.equal(verdict.status, 'failed'); assert.ok(verdict.reasons.some(r => r.includes(key) && r.includes('recapture')));
    }
    const missing = structuredClone(c.snapshot); delete missing.runtimeIdentity.inputs['mods/dep.jar'];
    assert.equal(verifyCaptureIdentity(missing, c.expected).status, 'failed');
    const added = structuredClone(c.snapshot); added.runtimeIdentity.inputs['mods/unreviewed.jar'] = digest('extra');
    assert.equal(verifyCaptureIdentity(added, c.expected).status, 'failed');
    await writeFile(path.join(c.directory, 'mods/mod.jar'), 'changed');
    await assert.rejects(createCaptureExpectation(c.directory, c.root, c.artifacts, c.expected.target, {session:'live-session',generation:2}, 'fresh'), /artifact mismatch/);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});
test('restart, request and generation changes cannot reuse old capture; changed loaded origins require restart', async () => {
  const c = await fixture();
  try {
    for (const key of ['launchNonce','requestId','session','generation'] as const) {
      const snapshot = structuredClone(c.snapshot); (snapshot.runtimeIdentity as any)[key] = key === 'generation' ? 3 : 'old';
      assert.equal(verifyCaptureIdentity(snapshot, c.expected).status, 'failed', key);
    }
    const snapshot = structuredClone(c.snapshot); snapshot.runtimeIdentity.loadedJars[0].sha256 = digest('replaced after boot');
    assert.equal(verifyCaptureIdentity(snapshot, c.expected).status, 'failed');
    const notLoaded = structuredClone(c.snapshot); notLoaded.runtimeIdentity.loadedJars = notLoaded.runtimeIdentity.loadedJars.slice(1); notLoaded.runtimeIdentity.startupJarsHash = identityHash(notLoaded.runtimeIdentity.loadedJars);
    assert.match(verifyCaptureIdentity(notLoaded, c.expected).reasons.join(' '), /not measured at a loaded mod origin/);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});
test('new expected inventory cannot falsely bind configuration, datapacks, scripts or JVM properties changed after startup', async () => {
  const c = await fixture();
  try {
    for(const file of ['config/mod.json','world/datapacks/custom/data/mod/recipe/a.json','scripts/a.zs']) {
      await writeFile(path.join(c.directory,file),'changed after boot before expectation');
      const expected = await createCaptureExpectation(c.directory,c.root,c.artifacts,c.expected.target,{session:'live-session',generation:2},'fresh_capture');
      const observed=structuredClone(c.snapshot);observed.runtimeIdentity.inputs=structuredClone(expected.inputs);
      assert.match(verifyCaptureIdentity(observed,expected).reasons.join(' '),/unchanged from startup.*restart/,file);
      observed.runtimeIdentity.inputs['mods/mod.jar']=digest('fabricated dump');
      assert.equal(expected.inputs['mods/mod.jar'],digest('mod.jar'),'expected inventory comes from owned files, never supplied dump');
    }
    const propertyExpected = {...c.expected,jvmProperties:{'mod.option':'changed'}};
    const propertyObserved = structuredClone(c.snapshot); propertyObserved.runtimeIdentity.jvmProperties = propertyExpected.jvmProperties as any;
    assert.match(verifyCaptureIdentity(propertyObserved, propertyExpected).reasons.join(' '), /unchanged from startup.*restart/);
  } finally { await rm(c.root,{recursive:true,force:true}); }
});
test('legacy, missing and malformed identity remain unsupported, never a required identity pass', async () => {
  const c = await fixture();
  try {
    assert.equal(verifyCaptureIdentity(c.snapshot).status, 'unsupported');
    for (const runtimeIdentity of [undefined, {schemaVersion:2}, {...c.snapshot.runtimeIdentity,status:'unsupported',errors:['development directory origin']}, {...c.snapshot.runtimeIdentity,loadedJars:{}}, {...c.snapshot.runtimeIdentity,inputs:{x:'invalid'}}]) {
      assert.equal(verifyCaptureIdentity({...c.snapshot,runtimeIdentity},c.expected).status, 'unsupported');
    }
    assert.throws(() => verifyCaptureIdentity(c.snapshot, {...c.expected,inputs:{'../private':digest('bad')}}), /Invalid capture expectation/);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});
test('capture input hashes refuse escaping symlinks and unrecorded dependencies', {skip:process.platform==='win32'}, async () => {
  const c = await fixture();
  try {
    await writeFile(path.join(c.directory, 'mods/unrecorded.jar'), 'extra');
    await assert.rejects(createCaptureExpectation(c.directory,c.root,c.artifacts,c.expected.target,{session:'live',generation:1},'fresh'), /Unrecorded dependency/);
    await symlink(c.root, path.join(c.directory,'config/outside'));
    await assert.rejects(captureInputs(c.directory), /outside|symlink/);
  } finally { await rm(c.root,{recursive:true,force:true}); }
});
