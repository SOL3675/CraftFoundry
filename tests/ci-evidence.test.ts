import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectFixtureEvidence } from '../.github/scripts/collect-fixture-evidence.mjs';

test('CI retains session failure logs without a final report and excludes worlds and caches', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mch-ci-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = path.join(root, '.harness/runs/interrupted-run/sessions/target/suite');
  for (const [name, content] of Object.entries({ 'client/logs/client.log': 'Actual startup failure', 'client/crash-reports/crash.txt': 'Actual crash diagnosis', 'server/world/private.log': 'world data', 'client/mct-cache/private.log': 'cache data' })) {
    const file = path.join(session, name);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content);
  }
  const truncated = path.join(root, '.harness/runs/truncated-run');
  await mkdir(path.join(truncated, 'sessions/target/client'), { recursive: true });
  await writeFile(path.join(truncated, 'report.json'), '{"unfinished":');
  await writeFile(path.join(truncated, 'sessions/target/client/failure.log'), 'Retain crash even when report write was interrupted');
  await collectFixtureEvidence(root);
  const output = path.join(root, '.harness/ci/evidence/runs/interrupted-run/sessions/target/suite');
  assert.equal(await readFile(path.join(output, 'client/logs/client.log'), 'utf8'), 'Actual startup failure');
  assert.equal(await readFile(path.join(output, 'client/crash-reports/crash.txt'), 'utf8'), 'Actual crash diagnosis');
  await assert.rejects(readFile(path.join(output, 'server/world/private.log')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(output, 'client/mct-cache/private.log')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, '.harness/ci/evidence/runs/truncated-run/sessions/target/client/failure.log'), 'utf8'), 'Retain crash even when report write was interrupted');
  assert.equal(await readFile(new URL('../.github/scripts/collect-fixture-evidence.mjs', import.meta.url), 'utf8'), await readFile(new URL('../templates/ci/scripts/collect-fixture-evidence.mjs', import.meta.url), 'utf8'));
});

test('CI copies declared JSON details outside sessions and explicitly fails if a companion disappears', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mch-ci-details-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = path.join(root, '.harness/runs/detail-run'); await mkdir(run, { recursive: true });
  const full = JSON.stringify({ reason: 'Complete detail 日本語🌋 <&> '.repeat(100000) });
  await writeFile(path.join(run, 'detail.json'), full);
  await writeFile(path.join(run, 'report.json'), JSON.stringify({ targets: [{ suites: [{ cases: [{ id: 'case', status: 'failed', detail: { file: 'detail.json', pointer: '/reason' } }] }] }] }));
  await collectFixtureEvidence(root);
  assert.equal(await readFile(path.join(root, '.harness/ci/evidence/runs/detail-run/detail.json'), 'utf8'), full);
  await rm(path.join(run, 'detail.json'));
  await assert.rejects(collectFixtureEvidence(root), { code: 'ENOENT' });
});
