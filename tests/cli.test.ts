import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));
const runSchema = JSON.parse(await readFile(new URL('../schemas/run.schema.json', import.meta.url), 'utf8'));
const validateRun = new Ajv({ strict: true, allErrors: true }).compile(runSchema);

async function fixture(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'mch CLI 日本語 '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'build', 'libs'), { recursive: true });
  await writeFile(path.join(root, 'build', 'libs', 'example.jar'), 'Explicit dummy distribution, never a game pass');
  const manifest = { schemaVersion: 1, target: 'fabric-1.21.1', minecraft: '1.21.1', loader: 'fabric',
    artifacts: [{ path: 'build/libs/example.jar', kind: 'distribution', side: 'both' }] };
  await writeFile(path.join(root, 'manifest-input.json'), JSON.stringify(manifest));
  const config: any = {
    schemaVersion: 1, projectId: 'cli-contract-fixture', builds: { main: { root: '.', adapter: 'gradle' } },
    targets: { 'fabric-1.21.1': { minecraft: '1.21.1', loader: 'fabric', build: 'main', tasks: { inspect: ['exportManifest'], build: ['assemble'], unit: ['unit'] }, artifactManifest: 'manifest.json', requiredSuites: ['unit'] } },
    suites: { unit: { driver: 'gradle', task: 'unit', results: 'results.json', expectedTests: ['fixture.first', 'fixture.second'], minTests: 2 }, unsupported: { driver: 'unsupported' } }, runtimes: {},
  };
  const save = () => writeFile(path.join(root, 'harness.config.json'), JSON.stringify(config));
  await save();
  await writeFile(path.join(root, 'wrapper.mjs'), `import { readFile, writeFile, appendFile, access } from 'node:fs/promises';
const args = process.argv.slice(2);
let mode = 'pass'; try { mode = (await readFile('mode.txt', 'utf8')).trim(); } catch {}
await appendFile('tasks.jsonl', JSON.stringify(args) + '\\n');
console.log('NOISY WRAPPER STDOUT'); console.error('NOISY WRAPPER STDERR');
if (args.includes('assemble') && mode === 'build-fail') process.exitCode = 7;
if (args.includes('exportManifest')) await writeFile('manifest.json', await readFile('manifest-input.json'));
if (args.includes('unit')) {
  if (mode === 'stale') {
    try { await access('results.json'); console.error('STALE FILE STILL EXISTS'); process.exitCode = 8; } catch {}
  } else {
    let cases = [{ id: 'fixture.first', status: 'passed' }, { id: 'fixture.second', status: 'passed' }];
    if (mode === 'zero') cases = [];
    if (mode === 'missing') cases = cases.slice(0, 1);
    if (mode === 'retry') cases[0].attempts = [{ status: 'failed' }, { status: 'passed' }];
    await writeFile('results.json', JSON.stringify({ schemaVersion: 1, cases }));
  }
}
`);
  if (process.platform === 'win32') await writeFile(path.join(root, 'gradlew.bat'), `@echo off\r\n"${process.execPath}" "%~dp0wrapper.mjs" %*\r\n`);
  else {
    await writeFile(path.join(root, 'gradlew'), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$(dirname "$0")/wrapper.mjs" "$@"\n`);
    await chmod(path.join(root, 'gradlew'), 0o755);
  }
  const mode = (value: string) => writeFile(path.join(root, 'mode.txt'), value);
  const invoke = async (...args: string[]) => {
    let result: any;
    try { result = { ...await execute(process.execPath, [cli, ...args, '--project', root, '--json'], { windowsHide: true, timeout: 30_000 }), code: 0 }; }
    catch (error: any) { result = { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
    assert.equal(typeof result.stdout, 'string', JSON.stringify(result));
    const output = JSON.parse(result.stdout);
    assert.equal(result.stdout.trim().split('\n').length, 1, 'JSON stdout must contain one machine-readable result');
    return { ...result, output };
  };
  return { root, config, save, mode, invoke };
}

test('targets JSON is clean, target selection is explicit, and configuration errors are structured', async (t) => {
  const f = await fixture(t);
  const targets = await f.invoke('targets'); assert.equal(targets.code, 0);
  assert.equal(targets.output.targets[0].id, 'fabric-1.21.1');
  assert.equal(targets.stdout.includes('NOISY WRAPPER'), false);
  const built = await f.invoke('build', '--all'); assert.equal(built.code, 0); assert.equal(built.output.command, 'mch build --target fabric-1.21.1');
  const unknown = await f.invoke('build', '--target', 'missing'); assert.equal(unknown.code, 2); assert.match(unknown.output.error, /Unknown target/);
  await writeFile(path.join(f.root, 'harness.config.json'), '{invalid');
  const invalid = await f.invoke('targets'); assert.equal(invalid.code, 2); assert.equal(invalid.output.code, 'CONFIG_INVALID');
  assert.match(invalid.output.diagnostics[0], /invalid JSON/);
});

test('doctor and required pilot suites reject a version-labeled backend without managed executable identity', async (t) => {
  const f = await fixture(t);
  const backend = path.join(f.root, 'manual', 'node_modules', '@kzheart_', 'mc-pilot'); await mkdir(backend, { recursive: true });
  await writeFile(path.join(backend, 'package.json'), JSON.stringify({ name: '@kzheart_/mc-pilot', version: '0.15.0' }));
  const sha256 = '369ea25fb7a563c97e8b9c1daed01411193579b78a838f5e774900cef8775629';
  await writeFile(path.join(f.root, 'harness.lock.json'), JSON.stringify({ schemaVersion: 1, tools: { pilot: { version: '0.15.0', sha256 }, helper: { version: '0.14.0', sha256: '0'.repeat(64) } } }));
  await writeFile(path.join(f.root, 'harness.local.json'), JSON.stringify({ schemaVersion: 1, backends: { pilot: backend }, eulaAccepted: true }));
  f.config.runtimes.server = { kind: 'server', capabilities: ['dedicated-server'], command: { executable: process.execPath, args: [] }, readyPattern: 'ready' };
  f.config.suites.pilot = { driver: 'fixture-multiplayer', runtime: 'server', pilot: { backend: 'pilot', helper: 'helper' }, expectedTests: ['multiplayer.connected'] };
  f.config.targets['fabric-1.21.1'].requiredSuites = ['pilot'];
  await f.save();
  const doctor = await f.invoke('doctor'); assert.equal(doctor.code, 2);
  assert.ok(doctor.output.diagnostics.some((item: any) => item.id === 'backend/pilot' && item.status === 'infrastructure-error' && /no managed installation metadata/.test(item.message)));
  const result = await f.invoke('test', '--target', 'fabric-1.21.1', '--profile', 'release');
  assert.equal(result.code, 2); assert.equal(result.output.targets[0].suites[0].status, 'infrastructure-error');
  assert.match(result.output.targets[0].suites[0].error, /no managed installation metadata/);
  assert.equal(result.output.targets[0].suites[0].detected, 0);
});

test('CLI successful test run has relative evidence, validated report, saved JUnit and noisy build logs off stdout', async (t) => {
  const f = await fixture(t);
  const result = await f.invoke('test', '--target', 'fabric-1.21.1');
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.output.status, 'passed');
  assert.equal(validateRun(result.output), true, JSON.stringify(validateRun.errors));
  assert.equal(result.stdout.includes('NOISY WRAPPER STDOUT'), false);
  assert.match(result.stderr, /test: fabric-1.21.1/);
  const target = result.output.targets[0];
  for (const relative of [...target.artifacts.map((artifact: any) => artifact.path), ...target.suites[0].logs]) {
    assert.equal(path.isAbsolute(relative), false); assert.equal(relative.includes('..'), false);
    await readFile(path.join(f.root, '.harness', 'runs', result.output.id, relative));
  }
  assert.equal(target.suites[0].detected, 2);
  const loaded = await f.invoke('report', '--run', result.output.id);
  assert.deepEqual(loaded.output, result.output);
  const junit = await readFile(path.join(f.root, '.harness', 'runs', result.output.id, 'junit.xml'), 'utf8');
  assert.match(junit, /fixture.first/); assert.match(junit, /fixture.second/);
});

test('zero detection, missing IDs and retry-only success are nonzero and reflected in CI JUnit', async (t) => {
  const f = await fixture(t);
  for (const mode of ['zero', 'missing', 'retry']) {
    await f.mode(mode);
    const result = await f.invoke('test', '--target', 'fabric-1.21.1');
    assert.equal(result.code, 1, result.stdout);
    assert.equal(result.output.status, 'failed');
    assert.equal(result.output.targets[0].suites[0].status, 'failed');
    const junit = await readFile(path.join(f.root, '.harness', 'runs', result.output.id, 'junit.xml'), 'utf8');
    assert.match(junit, /<(failure|error)\b/, `${mode}: ${junit}`);
  }
});

test('required unsupported suites cannot pass the release gate', async (t) => {
  const f = await fixture(t); f.config.targets['fabric-1.21.1'].requiredSuites.push('unsupported'); await f.save();
  const result = await f.invoke('test', '--all', '--profile', 'release');
  assert.equal(result.code, 1, result.stdout); assert.equal(result.output.status, 'failed');
  assert.equal(result.output.targets[0].suites[1].status, 'unsupported');
  assert.equal(result.output.targets[0].suites[1].required, true);
  const restricted = await f.invoke('test', '--all', '--profile', 'release', '--suite', 'unit');
  assert.equal(restricted.code, 2); assert.match(restricted.output.error, /cannot restrict/);
});

test('stale result files are removed before execution and cannot supply a false pass', async (t) => {
  const f = await fixture(t); await f.mode('stale');
  await writeFile(path.join(f.root, 'results.json'), JSON.stringify({ schemaVersion: 1, cases: [{ id: 'fixture.first', status: 'passed' }, { id: 'fixture.second', status: 'passed' }] }));
  const result = await f.invoke('test', '--target', 'fabric-1.21.1');
  assert.equal(result.code, 2); assert.equal(result.output.status, 'infrastructure-error');
  assert.match(result.output.targets[0].suites[0].error, /ENOENT/);
  assert.equal(result.stdout.includes('STALE FILE STILL EXISTS'), false);
  await assert.rejects(readFile(path.join(f.root, 'results.json')), /ENOENT/);
});

test('a suite requiring EULA cannot reuse previous game consent when local acceptance is false', async (t) => {
  const f = await fixture(t);
  f.config.suites.unit.eulaRequired = true; await f.save();
  await mkdir(path.join(f.root, 'build/gametest'), { recursive: true });
  await writeFile(path.join(f.root, 'build/gametest/eula.txt'), 'eula=true\n');
  const result = await f.invoke('test', '--target', 'fabric-1.21.1');
  assert.equal(result.code, 2);
  assert.match(result.output.targets[0].suites[0].error, /EULA acceptance is required/);
  const tasks = (await readFile(path.join(f.root, 'tasks.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(tasks.some(args => args.includes('unit')), false);
});

test('build failure has a nonzero exit and a failing JUnit record even without started suites', async (t) => {
  const f = await fixture(t); await f.mode('build-fail');
  const result = await f.invoke('test', '--target', 'fabric-1.21.1');
  assert.equal(result.code, 1); assert.equal(result.output.targets[0].suites.length, 0);
  const junit = await readFile(path.join(f.root, '.harness', 'runs', result.output.id, 'junit.xml'), 'utf8');
  assert.match(junit, /<(failure|error)\b/);
});

test('report traversal and invalid flag combinations return clean errors', async (t) => {
  const f = await fixture(t);
  for (const args of [ ['report', '--run', '../outside'], ['targets', '--suite', 'unit'], ['test', '--all', '--target', 'fabric-1.21.1'], ['build', '--target'], ['test', '--target', 'fabric-1.21.1', '--profile', 'unknown'] ]) {
    const result = await f.invoke(...args); assert.equal(result.code, 2); assert.equal(result.output.status, 'infrastructure-error');
  }
});
