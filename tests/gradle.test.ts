import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GradleBuildAdapter } from '../dist/adapters/build/gradle.js';
import type { ArtifactManifest, LoadedConfig } from '../src/core/types.ts';
import { parseResults } from '../dist/adapters/test/results.js';
import { gradleCommand } from '../dist/platform/gradle.js';
import { runProcess } from '../dist/platform/process.js';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'mch Gradle 日本語 '));
  await mkdir(path.join(root, 'build/libs'), { recursive: true });
  const manifest: ArtifactManifest = { schemaVersion: 1, target: 'fabric-1.21.1', minecraft: '1.21.1',
    loader: 'fabric', loaderVersion: '0.16.14', mappings: 'yarn:1.21.1', artifacts: [
      { path: 'build/libs/example.jar', kind: 'distribution', side: 'both' },
      { path: 'build/libs/example-sources.jar', kind: 'sources', side: 'both' },
    ] };
  await writeFile(path.join(root, 'manifest-input.json'), JSON.stringify(manifest));
  await writeFile(path.join(root, 'build/libs/example.jar'), 'distribution fixture');
  await writeFile(path.join(root, 'build/libs/example-sources.jar'), 'sources fixture');
  const script = `import { writeFile, appendFile, readFile, open, unlink } from 'node:fs/promises';
const args = process.argv.slice(2);
await appendFile('tasks.jsonl', JSON.stringify({ args, java: process.env.JAVA_HOME, gradleHome: process.env.GRADLE_USER_HOME }) + '\\n');
// /bin/sh can drop the dotted Gradle environment-property name. Model that
// loss on every host and require the intact project-property argument.
delete process.env['ORG_GRADLE_PROJECT_org.gradle.java.installations.paths'];
const javaPaths = JSON.parse(await readFile('java-input.json', 'utf8')).join(',');
if (!args.includes('-Porg.gradle.java.installations.paths=' + javaPaths)) throw new Error('Missing explicit project toolchain paths');
const active = await open('active.lock', 'wx');
try {
  if (args.includes('pause')) await new Promise(resolve => setTimeout(resolve, 120));
  if (args.includes('hang')) await new Promise(resolve => setTimeout(resolve, 30000));
  if (args.includes('failure')) process.exitCode = 9;
  if (args.includes('harnessExport')) await writeFile('manifest.json', await readFile('manifest-input.json'));
  if (args.includes('suiteA') || args.includes('suiteB')) {
    const id = args.includes('suiteA') ? 'fixture.A' : 'fixture.B';
    await writeFile('results.json', JSON.stringify({ schemaVersion: 1, cases: [{ id, status: 'passed', durationMs: 4, message: 'password=json-secret' }] }));
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  if (args.includes('xmlSuite')) await writeFile('results.xml', '<testsuite token="attribute-secret"><properties><property name="password" value="property-secret"/></properties><testcase classname="Fixture" name="xml" time="0.125"><failure message="password=xml-secret"><![CDATA[token=cdata-secret]]></failure></testcase></testsuite>');
  console.log('Gradle output fixture');
  console.error('Gradle stderr fixture');
} finally { await active.close(); await unlink('active.lock'); }
`;
  await writeFile(path.join(root, 'wrapper.mjs'), script);
  if (process.platform === 'win32') {
    await writeFile(path.join(root, 'gradlew.bat'), `@echo off\r\n"${process.execPath}" "%~dp0wrapper.mjs" %*\r\n`);
  } else {
    const executable = process.execPath.replaceAll("'", "'\\''");
    await writeFile(path.join(root, 'gradlew'), `#!/bin/sh\nexec '${executable}' "$(dirname "$0")/wrapper.mjs" "$@"\n`);
    await chmod(path.join(root, 'gradlew'), 0o755);
  }
  const loaded: LoadedConfig = { root, config: { schemaVersion: 1, projectId: 'test-mod',
    builds: { main: { root: '.', adapter: 'gradle', java: 'gradle-jdk' } },
    targets: { 'fabric-1.21.1': { minecraft: '1.21.1', loader: 'fabric', build: 'main',
      tasks: { inspect: ['harnessExport'], build: ['assemble'], slow: ['pause'], failure: ['failure'], hang: ['hang'], suiteA: ['suiteA'], suiteB: ['suiteB'], xmlSuite: ['xmlSuite'] },
      artifactManifest: 'manifest.json', requiredSuites: [], java: { game: 'game-jdk' } } }, suites: {}, runtimes: {} },
    local: { schemaVersion: 1, java: { 'gradle-jdk': path.join(root, 'JDK Gradle'), 'game-jdk': path.join(root, 'JDK Game') },
      timeouts: { build: 10_000 } }, lock: { schemaVersion: 1, tools: {} } };
  await writeFile(path.join(root, 'java-input.json'), JSON.stringify(Object.values(loaded.local.java!)));
  return { root, manifest, loaded, adapter: new GradleBuildAdapter(loaded), options: { logDir: path.join(root, 'logs') },
    cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('build refreshes manifest, preserves logs, selects Gradle Java role and snapshots explicit artifacts', async () => {
  const f = await fixture();
  try {
    const result = await f.adapter.build('fabric-1.21.1', f.options);
    assert.equal(result.status, 'passed', result.error);
    assert.equal(result.manifest?.target, 'fabric-1.21.1');
    const tasks = (await readFile(path.join(f.root, 'tasks.jsonl'), 'utf8')).trim().split('\n').map(value => JSON.parse(value));
    const javaLocations = `-Dorg.gradle.java.installations.paths=${Object.values(f.loaded.local.java!).join(',')}`;
    const projectJavaLocations = `-Porg.gradle.java.installations.paths=${Object.values(f.loaded.local.java!).join(',')}`;
    assert.deepEqual(tasks.map(task => task.args), [['--no-daemon', '--console=plain', javaLocations, projectJavaLocations, 'assemble'], ['--no-daemon', '--console=plain', javaLocations, projectJavaLocations, 'harnessExport']]);
    assert.equal(tasks[0].java, f.loaded.local.java?.['gradle-jdk']);
    assert.match(await readFile(result.process!.logs.stdout, 'utf8'), /Gradle output fixture/);
    const destination = path.join(f.root, 'snapshots');
    const artifacts = await f.adapter.collectArtifacts('fabric-1.21.1', destination);
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0]?.kind, 'distribution');
    assert.equal(artifacts[0]?.side, 'both');
    const expected = createHash('sha256').update('distribution fixture').digest('hex');
    assert.equal(artifacts[0]?.sha256, expected);
    await writeFile(path.join(f.root, 'build/libs/example.jar'), 'next build');
    assert.equal(await readFile(path.join(destination, artifacts[0]!.path), 'utf8'), 'distribution fixture');
    await assert.rejects(f.adapter.collectArtifacts('fabric-1.21.1', path.join(f.root, 'changed-snapshots')), /changed after build/);
    assert.ok(artifacts.every(artifact => !path.isAbsolute(artifact.path)));
    await assert.rejects(stat(path.join(f.root, '.harness/build-adapter.lock')), /ENOENT/);
  } finally { await f.cleanup(); }
});

test('wrapper requires explicit project toolchain paths when a dotted environment property is unavailable', async () => {
  const f = await fixture();
  try {
    const locations = Object.values(f.loaded.local.java!).join(',');
    assert.match(locations, /日本語/u); assert.match(locations, /JDK Gradle/u); assert.match(locations, /JDK Game/u);
    const missing = await runProcess({ ...gradleCommand(f.root, [`-Dorg.gradle.java.installations.paths=${locations}`, 'assemble']), cwd: f.root,
      env: { 'ORG_GRADLE_PROJECT_org.gradle.java.installations.paths': locations }, timeoutMs: 10_000, logDir: path.join(f.root, 'missing-project-property') });
    assert.equal(missing.status, 'failed'); assert.match(missing.stderr, /Missing explicit project toolchain paths/u);
    const passed = await f.adapter.runTasks('fabric-1.21.1', 'build', f.options);
    assert.equal(passed.status, 'passed', passed.stderr);
    const calls = (await readFile(path.join(f.root, 'tasks.jsonl'), 'utf8')).trim().split('\n').map(value => JSON.parse(value));
    assert.equal(calls[1].args.filter(value => value === `-Porg.gradle.java.installations.paths=${locations}`).length, 1);
    assert.equal(calls[1].args.filter(value => value === `-Dorg.gradle.java.installations.paths=${locations}`).length, 1);
  } finally { await f.cleanup(); }
});

test('resolved target mismatch and sources/development masquerading as distribution are rejected', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'manifest-input.json'), JSON.stringify({ ...f.manifest, minecraft: '1.20.1' }));
    const mismatch = await f.adapter.inspect('fabric-1.21.1', f.options);
    assert.equal(mismatch.status, 'infrastructure-error');
    assert.match(mismatch.error!, /does not match target/);
    f.loaded.config.targets['fabric-1.21.1']!.loaderVersion = '0.16.14';
    await writeFile(path.join(f.root, 'manifest-input.json'), JSON.stringify({ ...f.manifest, loaderVersion: '0.16.15' }));
    const loaderMismatch = await f.adapter.inspect('fabric-1.21.1', f.options);
    assert.equal(loaderMismatch.status, 'infrastructure-error');
    assert.match(loaderMismatch.error!, /Resolved loader version does not match/);
    await writeFile(path.join(f.root, 'manifest-input.json'), JSON.stringify({ ...f.manifest,
      artifacts: [{ path: 'build/libs/example-sources.jar', kind: 'distribution', side: 'both' }] }));
    const sources = await f.adapter.inspect('fabric-1.21.1', f.options);
    assert.equal(sources.status, 'infrastructure-error');
    assert.match(sources.error!, /cannot be a distribution/);
    await writeFile(path.join(f.root, 'manifest-input.json'), JSON.stringify({ ...f.manifest,
      artifacts: [{ path: 'build/libs/*.jar', kind: 'distribution', side: 'both' }] }));
    assert.equal((await f.adapter.inspect('fabric-1.21.1', f.options)).status, 'infrastructure-error');
    await writeFile(path.join(f.root, 'manifest-input.json'), JSON.stringify({ ...f.manifest,
      artifacts: [{ path: 'build/libs/directory.jar', kind: 'distribution', side: 'both' }] }));
    await mkdir(path.join(f.root, 'build/libs/directory.jar'));
    assert.match((await f.adapter.inspect('fabric-1.21.1', f.options)).error!, /regular file/);
  } finally { await f.cleanup(); }
});

test('same-root operations serialize; ambiguous persisted lock is retained', async () => {
  const f = await fixture();
  try {
    const other = new GradleBuildAdapter(f.loaded);
    const outcomes = await Promise.all([
      f.adapter.runTasks('fabric-1.21.1', 'slow', { logDir: path.join(f.root, 'logs-a') }),
      other.runTasks('fabric-1.21.1', 'slow', { logDir: path.join(f.root, 'logs-b') }),
    ]);
    assert.ok(outcomes.every(outcome => outcome.status === 'passed'));
    const lockFile = path.join(f.root, '.harness/build-adapter.lock');
    await writeFile(lockFile, JSON.stringify({ pid: 1, token: 'another-owner' }));
    await assert.rejects(f.adapter.runTasks('fabric-1.21.1', 'slow', f.options), /Build root is locked/);
    assert.match(await readFile(lockFile, 'utf8'), /another-owner/);
  } finally { await f.cleanup(); }
});

test('successful inspection task must refresh its generated manifest; explicit manual manifests remain supported', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.adapter.inspect('fabric-1.21.1', f.options)).status, 'passed');
    const target = f.loaded.config.targets['fabric-1.21.1']!;
    target.tasks.inspect = ['assemble'];
    const stale = await f.adapter.inspect('fabric-1.21.1', { logDir: path.join(f.root, 'stale') });
    assert.equal(stale.status, 'infrastructure-error');
    assert.match(stale.error!, /did not refresh/);
    delete target.tasks.inspect;
    assert.equal((await f.adapter.inspect('fabric-1.21.1', f.options)).status, 'passed');
  } finally { await f.cleanup(); }
});

test('Gradle failure, timeout and pre-cancellation keep classifications and release root lock', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.adapter.runTasks('fabric-1.21.1', 'failure', f.options)).status, 'failed');
    f.loaded.local.timeouts!.build = 250;
    assert.equal((await f.adapter.runTasks('fabric-1.21.1', 'hang', { logDir: path.join(f.root, 'timeout') })).status, 'timed-out');
    await assert.rejects(stat(path.join(f.root, '.harness/build-adapter.lock')), /ENOENT/);
    const controller = new AbortController(); controller.abort();
    assert.equal((await f.adapter.runTasks('fabric-1.21.1', 'slow', { logDir: path.join(f.root, 'cancel'), signal: controller.signal })).status, 'cancelled');
    await assert.rejects(stat(path.join(f.root, '.harness/build-adapter.lock')), /ENOENT/);
  } finally { await f.cleanup(); }
});

test('overlapping suite runs hold root ownership through result capture and preserve separate redacted evidence', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'results.json'), JSON.stringify({ schemaVersion: 1, cases: [{ id: 'stale', status: 'passed' }] }));
    const other = new GradleBuildAdapter(f.loaded);
    const results = await Promise.all([
      f.adapter.runTasksWithResults('fabric-1.21.1', 'suiteA', 'results.json', path.join(f.root, 'run-a'), { logDir: path.join(f.root, 'logs-a') }),
      other.runTasksWithResults('fabric-1.21.1', 'suiteB', 'results.json', path.join(f.root, 'run-b'), { logDir: path.join(f.root, 'logs-b') }),
    ]);
    assert.deepEqual(results.map(result => result.process.status), ['passed', 'passed']);
    assert.deepEqual((await parseResults(results[0]!.resultFile!)).map(test => test.id), ['fixture.A']);
    assert.deepEqual((await parseResults(results[1]!.resultFile!)).map(test => test.id), ['fixture.B']);
    // Concurrent context resolution can acquire the root in either order.
    // Each immutable snapshot must retain its own result; shared output belongs to the last task.
    const invocations = (await readFile(path.join(f.root, 'tasks.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const lastId = invocations.at(-1).args.includes('suiteA') ? 'fixture.A' : 'fixture.B';
    assert.equal(JSON.parse(await readFile(path.join(f.root, 'results.json'), 'utf8')).cases[0].id, lastId);
    for (const result of results) {
      const evidence = await readFile(result.resultFile!, 'utf8');
      assert.equal(evidence.includes('json-secret'), false);
      assert.match(evidence, /password=\[REDACTED\]/);
      assert.equal(evidence.includes('stale'), false);
    }
    await writeFile(path.join(f.root, 'results.json'), 'next external run');
    assert.equal((await parseResults(results[0]!.resultFile!))[0]!.durationMs, 4);
    await assert.rejects(stat(path.join(f.root, '.harness/build-adapter.lock')), /ENOENT/);
  } finally { await f.cleanup(); }
});

test('XML evidence is redacted without corrupting attributes, CDATA, IDs or assertion status', async () => {
  const f = await fixture();
  try {
    const result = await f.adapter.runTasksWithResults('fabric-1.21.1', 'xmlSuite', 'results.xml', path.join(f.root, 'xml-evidence'), f.options);
    assert.equal(path.basename(result.resultFile!), 'result.xml');
    const cases = await parseResults(result.resultFile!);
    assert.equal(cases[0]!.id, 'Fixture.xml');
    assert.equal(cases[0]!.status, 'failed');
    assert.equal(cases[0]!.durationMs, 125);
    const evidence = await readFile(result.resultFile!, 'utf8');
    assert.equal(evidence.includes('xml-secret'), false);
    assert.equal(evidence.includes('cdata-secret'), false);
    assert.equal(evidence.includes('attribute-secret'), false);
    assert.equal(evidence.includes('property-secret'), false);
    assert.match(cases[0]!.message!, /password=\[REDACTED\]/);
    assert.match(cases[0]!.message!, /token=\[REDACTED\]/);
  } finally { await f.cleanup(); }
});

test('missing new results cannot fall back to stale output; failed processes keep classification', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'results.json'), JSON.stringify({ schemaVersion: 1, cases: [{ id: 'stale', status: 'passed' }] }));
    await assert.rejects(f.adapter.runTasksWithResults('fabric-1.21.1', 'build', 'results.json', path.join(f.root, 'stale-evidence'), f.options), /ENOENT/);
    await assert.rejects(stat(path.join(f.root, 'results.json')), /ENOENT/);
    await assert.rejects(stat(path.join(f.root, 'stale-evidence')), /ENOENT/);
    const failure = await f.adapter.runTasksWithResults('fabric-1.21.1', 'failure', 'results.json', path.join(f.root, 'failed-evidence'), f.options);
    assert.equal(failure.process.status, 'failed'); assert.equal(failure.resultFile, undefined);
    await assert.rejects(stat(path.join(f.root, '.harness/build-adapter.lock')), /ENOENT/);
  } finally { await f.cleanup(); }
});

test('suite result paths reject directories, globs, traversal and escaping junctions without deleting files', async t => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'mch outside results '));
  try {
    await mkdir(path.join(f.root, 'results.json'));
    await assert.rejects(f.adapter.runTasksWithResults('fabric-1.21.1', 'suiteA', 'results.json', path.join(f.root, 'unsafe-evidence'), f.options), /regular file/);
    assert.equal((await stat(path.join(f.root, 'results.json'))).isDirectory(), true);
    for (const relative of ['../outside.json', '..\\outside.json', 'results/*.json', '/outside.json', 'C:\\outside.json']) {
      await assert.rejects(f.adapter.runTasksWithResults('fabric-1.21.1', 'suiteA', relative, path.join(f.root, 'unsafe-evidence'), f.options), /explicit relative/);
    }
    await writeFile(path.join(outside, 'results.json'), 'outside sentinel');
    try { await symlink(outside, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('symlink creation unavailable'); return; } throw error; }
    for (const relative of ['escape/results.json', 'escape/missing/results.json']) {
      await assert.rejects(f.adapter.runTasksWithResults('fabric-1.21.1', 'suiteA', relative, path.join(f.root, 'unsafe-evidence'), f.options), /escapes build root/);
    }
    assert.equal(await readFile(path.join(outside, 'results.json'), 'utf8'), 'outside sentinel');
    await assert.rejects(stat(path.join(f.root, 'tasks.jsonl')), /ENOENT/);
  } finally { await f.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('result-capturing suites use the test timeout independently of build timeout', async () => {
  const f = await fixture();
  try {
    f.loaded.local.timeouts!.build = 10_000;
    f.loaded.local.timeouts!.test = 250;
    const result = await f.adapter.runTasksWithResults('fabric-1.21.1', 'hang', 'results.json', path.join(f.root, 'timeout-evidence'), f.options);
    assert.equal(result.process.status, 'timed-out'); assert.equal(result.resultFile, undefined);
    assert.ok(result.process.durationMs < 10_000);
    await assert.rejects(stat(path.join(f.root, '.harness/build-adapter.lock')), /ENOENT/);
  } finally { await f.cleanup(); }
});

test('Gradle cache defaults to project isolation and preserves an explicitly inherited cache', async () => {
  const f = await fixture();
  const previous = process.env.GRADLE_USER_HOME;
  try {
    delete process.env.GRADLE_USER_HOME;
    assert.equal((await f.adapter.runTasks('fabric-1.21.1', 'slow', f.options)).status, 'passed');
    process.env.GRADLE_USER_HOME = path.join(f.root, 'Explicit Gradle Cache');
    assert.equal((await f.adapter.runTasks('fabric-1.21.1', 'slow', f.options)).status, 'passed');
    const tasks = (await readFile(path.join(f.root, 'tasks.jsonl'), 'utf8')).trim().split('\n').map(value => JSON.parse(value));
    assert.equal(tasks[0].gradleHome, path.join(f.root, '.harness', 'cache', 'gradle'));
    assert.equal(tasks[1].gradleHome, process.env.GRADLE_USER_HOME);
  } finally {
    if (previous === undefined) delete process.env.GRADLE_USER_HOME;
    else process.env.GRADLE_USER_HOME = previous;
    await f.cleanup();
  }
});
