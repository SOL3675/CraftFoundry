import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ajv } from 'ajv';
import { createRun, readReport, saveReport, toJUnit } from '../dist/reporting/report.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redact, redactText } from '../dist/reporting/redact.js';
import type { RunReport } from '../src/reporting/types.ts';

function report(): RunReport {
  return {
    schemaVersion: 1, id: 'test-run', command: 'mch test --all --profile release', startedAt: '2026-09-30T07:00:00.000Z', finishedAt: '2026-09-30T07:00:01.000Z',
    status: 'passed', harnessVersion: '0.1.0', platform: { os: process.platform, arch: process.arch, node: process.version },
    source: { limitations: [] }, configuration: {}, lock: { schemaVersion: 1, tools: {} },
    reproduction: { command: 'mch test --all --profile release', limitations: [] },
    targets: [{ id: 'fabric-1.21.1', minecraft: '1.21.1', loader: 'fabric', status: 'passed', artifacts: [],
      suites: [{ id: 'unit', required: true, status: 'passed', detected: 1, cases: [{ id: 'fixture.test', status: 'passed', durationMs: 125 }] }] }],
  };
}

async function directory(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'mch reports '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('a project ignored by its parent Git repository cannot claim the parent source revision', async (t) => {
  const root = await directory(t);
  await promisify(execFile)('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await writeFile(path.join(root, '.gitignore'), '/project/\n');
  const project = path.join(root, 'project'); await mkdir(project);
  const loaded = { root: project, config: { schemaVersion: 1, projectId: 'ignored-project', builds: {}, targets: {}, suites: {}, runtimes: {} }, local: { schemaVersion: 1 }, lock: { schemaVersion: 1, tools: {} } } as const;
  const { report: result } = await createRun(loaded, 'mch build --all');
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(result.harnessVersion, version);
  assert.equal(result.source.revision, undefined);
  assert.match(result.source.limitations.join('\n'), /ignored by its parent Git repository/);
});

test('normal JUnit has testcase durations and escaped diagnostics without invalid XML characters', () => {
  const value = report();
  value.targets[0]!.suites[0]!.cases[0] = { id: '<case & "name">', status: 'failed', message: '<expected> & bad\u0001', durationMs: 125 };
  value.targets[0]!.suites[0]!.status = 'failed';
  value.status = 'failed';
  const xml = toJUnit(value);
  assert.match(xml, /time="0.125"/);
  assert.match(xml, /&lt;case &amp; &quot;name&quot;&gt;/);
  assert.match(xml, /failures="1"/);
  assert.equal(xml.includes('\u0001'), false);
});

test('suite detection errors remain visible to JUnit even when detected cases individually passed', () => {
  for (const error of ['Expected case not detected: missing', 'Detected 1 cases; minimum is 2', 'Duplicate case fixture.test']) {
    const value = report();
    value.status = value.targets[0]!.status = 'failed';
    value.targets[0]!.suites[0]!.status = 'failed';
    value.targets[0]!.suites[0]!.error = error;
    const xml = toJUnit(value);
    assert.match(xml, /<(failure|error)\b/, error);
    assert.ok(xml.includes(error), xml);
  }
});

test('required unsupported gates and build failures are JUnit errors including mixed-target runs', () => {
  const value = report();
  value.targets[0]!.suites[0] = { id: 'client-smoke', required: true, status: 'unsupported', detected: 0, cases: [], error: 'No verified driver' };
  value.status = value.targets[0]!.status = 'failed';
  assert.match(toJUnit(value), /errors="1"/);
  const mixed = report(); mixed.status = 'failed';
  mixed.targets.push({ id: 'neoforge-1.21.1', minecraft: '1.21.1', loader: 'neoforge', status: 'failed', artifacts: [], suites: [], error: 'Gradle build exploded' });
  assert.match(toJUnit(mixed), /Gradle build exploded/);
  assert.match(toJUnit(mixed), /<(failure|error)\b/);
  const buildOnly = report(); buildOnly.status = 'infrastructure-error'; buildOnly.targets = []; buildOnly.error = 'Missing Java';
  assert.match(toJUnit(buildOnly), /Missing Java/);
});

test('saveReport redacts nested credentials in JSON and JUnit while preserving diagnostics', async (t) => {
  const root = await directory(t);
  const value = report(); value.status = 'failed';
  value.configuration = { token: 'nested-secret', args: ['password=command-secret', 'Bearer bearer-secret', 'https://user:url-secret@example.test/file'] };
  value.targets[0]!.suites[0]!.cases[0] = { id: 'secret-test', status: 'failed', message: 'Fixture failed; token=case-secret; password=case-password' };
  await saveReport(root, value);
  for (const filename of ['report.json', 'junit.xml']) {
    const contents = await readFile(path.join(root, filename), 'utf8');
    for (const secret of ['nested-secret', 'command-secret', 'bearer-secret', 'url-secret', 'case-secret', 'case-password']) assert.equal(contents.includes(secret), false, `${filename} exposed ${secret}`);
    assert.match(contents, /Fixture failed/);
    assert.match(contents, /REDACTED/);
  }
});

test('redaction handles generic token assignment and URI credentials', () => {
  assert.equal(redactText('token=generic-token'), 'token=[REDACTED]');
  assert.deepEqual(redact({ password: 'hidden', diagnostics: ['refresh_token=refresh-secret', 'Bearer jwt-secret'] }), { password: '[REDACTED]', diagnostics: ['refresh_token=[REDACTED]', 'Bearer [REDACTED]'] });
});

test('reports round-trip, reject traversal and inconsistent report identities', async (t) => {
  const root = await directory(t);
  const destination = path.join(root, '.harness', 'runs', 'test-run'); await mkdir(destination, { recursive: true });
  await saveReport(destination, report());
  assert.deepEqual(await readReport(root, 'test-run'), report());
  for (const id of ['../test-run', '..\\test-run', 'C:\\outside', '/outside']) await assert.rejects(readReport(root, id), /Invalid run ID/);
  await writeFile(path.join(destination, 'report.json'), JSON.stringify({ ...report(), id: 'other-run' }));
  await assert.rejects(readReport(root, 'test-run'), /Invalid run report/);
});

test('report access cannot follow a run-directory symlink outside project', async (t) => {
  const root = await directory(t); const outside = await directory(t);
  await mkdir(path.join(root, '.harness', 'runs'), { recursive: true });
  const destination = path.join(outside, 'test-run'); await mkdir(destination);
  await saveReport(destination, report());
  try { await symlink(destination, path.join(root, '.harness', 'runs', 'test-run'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('symlink creation unavailable'); return; } throw error; }
  await assert.rejects(readReport(root, 'test-run'), /escape|outside|contain/i);
});

test('run JSON Schema validates reports and rejects absolute evidence paths and invalid statuses', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/run.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
  const value = report(); assert.equal(validate(value), true, JSON.stringify(validate.errors));
  value.targets[0]!.suites[0]!.logs = ['logs/fabric/unit/stdout.log'];
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  value.targets[0]!.suites[0]!.logs = ['/personal/outside.log'];
  assert.equal(validate(value), false);
  value.targets[0]!.suites[0]!.logs = ['logs/fabric/unit/stdout.log'];
  (value as any).status = 'success'; assert.equal(validate(value), false);
});
