import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseResults, evaluateSuite } from '../dist/adapters/test/results.js';

async function resultFile(t: any, text: string, extension = 'json') {
  const root = await mkdtemp(path.join(tmpdir(), 'mch results '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, `results.${extension}`);
  await writeFile(file, text);
  return file;
}

test('zero cases fail the detection gate even with a clean process exit', async (t) => {
  const cases = await parseResults(await resultFile(t, JSON.stringify({ schemaVersion: 1, cases: [] })));
  const evaluated = evaluateSuite('unit', { driver: 'gradle', task: 'unit' }, cases, true);
  assert.equal(evaluated.status, 'failed');
  assert.match(evaluated.error!, /Detected 0 cases/);
});

test('declared IDs and minimum count must both be satisfied and duplicates cannot inflate detection', () => {
  const suite = { driver: 'gradle', task: 'unit', minTests: 2, expectedTests: ['first', 'second'] } as const;
  const missing = evaluateSuite('unit', suite as any, [{ id: 'first', status: 'passed' }], true);
  assert.equal(missing.status, 'failed');
  assert.match(missing.error!, /minimum is 2/);
  assert.match(missing.error!, /Expected case not detected: second/);
  const duplicate = evaluateSuite('unit', suite as any, [{ id: 'first', status: 'passed' }, { id: 'first', status: 'passed' }], true);
  assert.equal(duplicate.status, 'failed');
  assert.match(duplicate.error!, /Duplicate case first/);
});

test('required skipped and unsupported cases cannot satisfy release validation', () => {
  for (const status of ['unsupported', 'skipped'] as const) {
    const required = evaluateSuite('smoke', { driver: 'unsupported' }, [{ id: 'case', status }], true);
    assert.equal(required.status, 'failed');
    assert.match(required.error!, /Required suite contains unsupported or unexecuted/);
    const optional = evaluateSuite('smoke', { driver: 'unsupported' }, [{ id: 'case', status }], false);
    assert.equal(optional.status, 'skipped');
  }
});

test('retry success records attempts but is not promoted to a stable pass', async (t) => {
  const cases = await parseResults(await resultFile(t, JSON.stringify({ schemaVersion: 1, cases: [
    { id: 'sync', status: 'passed', attempts: [{ status: 'failed', message: 'Out of sync' }, { status: 'passed' }] },
  ] })));
  assert.equal(cases[0]!.status, 'failed');
  assert.equal(cases[0]!.attempts!.length, 2);
  assert.match(cases[0]!.message!, /not a stable pass/);
  assert.equal(evaluateSuite('sync', { driver: 'process' }, cases, true).status, 'failed');
});

test('invalid JSON contracts, statuses, and case IDs are diagnosed', async (t) => {
  for (const value of [{ schemaVersion: 2, cases: [] }, { schemaVersion: 1 }, { schemaVersion: 1, cases: [{ id: 'a', status: 'success' }] }, { schemaVersion: 1, cases: [{ id: '', status: 'passed' }] }]) {
    await assert.rejects(parseResults(await resultFile(t, JSON.stringify(value))), /require|Invalid/);
  }
});

test('malformed case metadata and attempt histories cannot become successful typed reports', async (t) => {
  for (const metadata of [
    { durationMs: -1 }, { durationMs: 'fast' }, { message: { text: 'not a string' } },
    { attempts: 'not an array' }, { attempts: [{ status: 'success' }] }, { attempts: [{ status: 'passed', message: 42 }] },
  ]) {
    const value = { schemaVersion: 1, cases: [{ id: 'fixture', status: 'passed', ...metadata }] };
    await assert.rejects(parseResults(await resultFile(t, JSON.stringify(value))), /Invalid|attempt|duration|message/i);
  }
});

test('diagnostic counts and detail references are optional structured versioned metadata, rejecting malformed input', async t => {
  const diagnostics = { schemaVersion: 1, counts: { incomplete: 10000, unknown: 1, stopReasons: 2 } };
  const detail = { file: 'details/日本語 reason.json', pointer: '/details/0' };
  const cases = [{ id: 'survival.item', status: 'unsupported', message: 'summary', diagnostics, detail }];
  assert.deepEqual(await parseResults(await resultFile(t, JSON.stringify({ schemaVersion: 1, cases }))), cases);
  for (const metadata of [
    { detail: { ...detail, file: '../outside.json' } }, { detail: { ...detail, file: 'C:/outside.json' } },
    { detail: { ...detail, file: '/outside.json' } }, { detail: { ...detail, file: 'details\\outside.json' } },
    { detail: { ...detail, pointer: '/bad~2' } }, { detail: { ...detail, pointer: 'details/0' } },
    { detail: { ...detail, file: 'detail.bin' } }, { detail: { ...detail, file: 'detail\n.json' } },
    { detail: { ...detail, file: 'detail\ud800.json' } }, { detail: { ...detail, pointer: '/bad\nkey' } },
    { diagnostics: { ...diagnostics, schemaVersion: 2 } }, { diagnostics: { schemaVersion: 1, counts: { unknown: 1 } } },
    { diagnostics: { ...diagnostics, counts: { ...diagnostics.counts, unknown: -1 } } },
    { diagnostics: { ...diagnostics, counts: { ...diagnostics.counts, unknown: 'giant' } } },
  ]) await assert.rejects(parseResults(await resultFile(t, JSON.stringify({ schemaVersion: 1, cases: [{ ...cases[0], ...metadata }] }))), /Invalid/);
});

test('JUnit imports stable IDs, durations, assertions, infrastructure errors and skipped cases', async (t) => {
  const cases = await parseResults(await resultFile(t, `<testsuites><testsuite name="unit" tests="4">
    <testcase classname="Fixture" name="good" time="0.125"/>
    <testcase classname="Fixture" name="bad"><failure message="assertion">Expected &lt;2&gt; received 1</failure></testcase>
    <testcase classname="Fixture" name="error"><error message="crash"/></testcase>
    <testcase name="skip"><skipped message="disabled"/></testcase>
  </testsuite></testsuites>`, 'xml'));
  assert.equal(cases[0]!.id, 'Fixture.good');
  assert.equal(cases[0]!.durationMs, 125);
  assert.deepEqual(cases.map(c => c.status), ['passed', 'failed', 'infrastructure-error', 'skipped']);
  assert.match(cases[1]!.message!, /Expected <2> received 1/);
});

test('JUnit declared counts do not replace actual case detection and DOCTYPE is rejected', async (t) => {
  const cases = await parseResults(await resultFile(t, '<testsuite tests="99" failures="0"/>', 'xml'));
  assert.equal(evaluateSuite('unit', { driver: 'gradle' }, cases, true).status, 'failed');
  await assert.rejects(parseResults(await resultFile(t, '<!DOCTYPE testsuite [<!ENTITY leak SYSTEM "file:///secret">]><testsuite/>', 'xml')), /DOCTYPE/);
  await assert.rejects(parseResults(await resultFile(t, '<testsuite><testcase name="a"></testsuite>', 'xml')));
});
