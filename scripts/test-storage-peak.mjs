import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, stat, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireStorageLease, attachStorageEvidence, cleanupStorage, closeStorageReservation, createStorageEvidenceSeal, createStorageReservation, createStorageUnit, finalizeStorageUnit, releaseStorageLease, validateStorageEvidenceSeal } from '../dist/core/storage.js';
import { readReport, saveReport } from '../dist/reporting/report.js';

// Synthetic logical-size experiment only. Never adopts or removes existing data.
// Retain the owned fixture and evidence so the measurements remain reviewable.
if (process.argv.length !== 4 || process.argv[2] !== '--output-dir') throw new Error('Usage: node scripts/test-storage-peak.mjs --output-dir <temporary or repository .harness directory>');
const repository = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const output = path.resolve(process.argv[3]);
const within = (root, file) => { const relative = path.relative(root, file); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const temporary = await realpath(tmpdir());
if (!within(temporary, output) && !within(path.join(repository, '.harness'), output)) throw new Error('Output must be inside the system temporary directory or this repository .harness');
for (let current = output; ; current = path.dirname(current)) {
  try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Output path must not traverse links or junctions'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (path.dirname(current) === current) break;
}
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(output, 'storage-peak-owned-'));
const stageCount = 24, bytesPerStage = 8 * 1024 * 1024;
const payload = Buffer.alloc(bytesPerStage, 0x5a);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const free = async directory => { const info = await statfs(directory, { bigint: true }); return String(info.bavail * info.bsize); };

async function benchmark(mode) {
  const root = path.join(fixture, mode); const run = path.join(root, '.harness/runs/long-unfinished-run');
  await mkdir(run, { recursive: true });
  const report = { schemaVersion: 1, id: path.basename(run), command: 'synthetic storage peak contract', startedAt: new Date().toISOString(),
    status: 'infrastructure-error', harnessVersion: 'synthetic', platform: { os: process.platform, arch: process.arch, node: process.version },
    source: { limitations: ['Synthetic dependencies; no Minecraft process started.'] }, configuration: {}, lock: {}, targets: [], reproduction: { command: 'node scripts/test-storage-peak.mjs --output-dir <temporary-directory>', limitations: ['Synthetic logical sizes do not establish allocated blocks or real Minecraft savings.'] } };
  await saveReport(run, report);
  const world = 'sessions/retained/world/level.dat'; await mkdir(path.dirname(path.join(run, world)), { recursive: true });
  await writeFile(path.join(run, world), 'retained synthetic world');
  const worldHash = sha256(await readFile(path.join(run, world)));
  const retainedHashes = new Map([[world, worldHash]]), caches = [], units = [], references = [], observations = [];
  let logicalCachePeakBytes = 0, cumulativeDeletedBytes = 0, restartGapProtected = false;
  async function observe(stage, phase) {
    let logicalCacheBytes = 0;
    for (const cache of caches) try { logicalCacheBytes += (await stat(path.join(cache, 'dependency.jar'))).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    logicalCachePeakBytes = Math.max(logicalCachePeakBytes, logicalCacheBytes);
    observations.push({ stage, phase, logicalCacheBytes, availableBytes: await free(root), measuredAt: new Date().toISOString() });
  }
  async function seal(stage, phase) {
    const file = `sessions/target/stage-${stage}/${phase}.binary`; await mkdir(path.dirname(path.join(run, file)), { recursive: true });
    await writeFile(path.join(run, file), `stage ${stage}: ${phase}: saved diagnostic evidence`);
    retainedHashes.set(file, sha256(await readFile(path.join(run, file))));
    const reference = await createStorageEvidenceSeal(root, run, { scope: { target: 'target', suite: `stage-${stage}`, phase }, files: [file, world] });
    await attachStorageEvidence(root, run, [reference]); references.push(reference); return reference;
  }
  await observe(0, 'before');
  for (let stage = 1; stage <= stageCount; stage++) {
    assert.equal((await readReport(root, report.id)).finishedAt, undefined, 'Run must remain unfinished during every stage');
    const cache = path.join(root, '.harness/c', randomUUID(), 'mct-cache/client'); caches.push(cache);
    const unit = mode === 'staged' ? await createStorageReservation(root, cache) : await createStorageUnit(root, cache); units.push(unit);
    const lease = mode === 'staged' ? await acquireStorageLease(root, unit) : undefined;
    await mkdir(cache, { recursive: true }); await writeFile(path.join(cache, 'dependency.jar'), payload);
    await observe(stage, 'prepared');
    const first = await seal(stage, stage === 12 ? 'seed' : 'complete');
    if (lease) await releaseStorageLease(root, lease, { stopped: true, evidenceRoot: run, seal: first });
    if (stage === 12) {
      const preview = await cleanupStorage(root, { unitIds: [unit.id] });
      assert.equal(preview.reclaimableBytes, 0, 'Restart gap must keep dependencies reserved');
      assert.equal((await cleanupStorage(root, { apply: true, unitIds: [unit.id] })).deletedBytes, 0);
      assert.equal((await stat(path.join(cache, 'dependency.jar'))).size, bytesPerStage);
      const restartLease = mode === 'staged' ? await acquireStorageLease(root, unit) : undefined;
      const second = await seal(stage, 'restore');
      if (restartLease) await releaseStorageLease(root, restartLease, { stopped: true, evidenceRoot: run, seal: second });
      restartGapProtected = true;
    }
    if (mode === 'staged') {
      await closeStorageReservation(root, unit);
      const result = await cleanupStorage(root, { apply: true, unitIds: [unit.id] });
      assert.deepEqual(result.errors, []); assert.equal(result.deletedBytes, bytesPerStage); cumulativeDeletedBytes += result.deletedBytes;
    } else assert.equal((await cleanupStorage(root, { unitIds: [unit.id] })).reclaimableBytes, 0);
    await observe(stage, 'completed-while-run-unfinished');
  }
  assert.equal((await readReport(root, report.id)).finishedAt, undefined);
  report.finishedAt = new Date().toISOString(); report.status = 'passed'; await saveReport(run, report);
  if (mode === 'legacy-finished-run') {
    for (const unit of units) await finalizeStorageUnit(root, unit, { stopped: true, evidenceRoot: run });
    const result = await cleanupStorage(root, { apply: true, unitIds: units.map(unit => unit.id) });
    assert.deepEqual(result.errors, []); cumulativeDeletedBytes += result.deletedBytes;
  }
  await observe(stageCount, 'run-finished-and-cleaned');
  const final = await readReport(root, report.id);
  assert.equal(final.storageEvidence.length, references.length);
  for (const reference of final.storageEvidence) await validateStorageEvidenceSeal(run, reference);
  for (const [file, expected] of retainedHashes) assert.equal(sha256(await readFile(path.join(run, file))), expected, `Retained evidence changed: ${file}`);
  assert.equal(cumulativeDeletedBytes, stageCount * bytesPerStage);
  return { mode, root, run, stageCount, bytesPerStage, logicalCachePeakBytes, cumulativeDeletedBytes, restartGapProtected, allStagesObservedUnfinished: true,
    retainedWorldSha256: worldHash, retainedEvidenceHashesUnchanged: true, validatedFinalReferences: references.length, observations };
}

const baseline = await benchmark('legacy-finished-run');
const staged = await benchmark('staged');
assert.equal(baseline.logicalCachePeakBytes, stageCount * bytesPerStage);
assert.equal(staged.logicalCachePeakBytes, bytesPerStage);
const measurement = { schemaVersion: 1, measuredAt: new Date().toISOString(), fixture, sizeKind: 'logical', synthetic: true,
  limitations: ['24 sequential synthetic 8 MiB dependencies per mode; no Minecraft, Mod, or Realmloom execution.', 'statfs free-space observations include unrelated filesystem activity and are not physical savings measurements.', 'Both modes ultimately reclaim the same dependency bytes; staged mode lowers unfinished-Run cache peak.', 'Worlds, evidence, seals and measurement fixtures are retained; no existing data is adopted or removed.'],
  baseline, staged, logicalPeakReductionBytes: baseline.logicalCachePeakBytes - staged.logicalCachePeakBytes };
const measurementPath = path.join(output, `storage-peak-measurement-${randomUUID()}.json`);
const handle = await open(measurementPath, 'wx');
try { await handle.writeFile(`${JSON.stringify(measurement, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
console.log(JSON.stringify({ measurementPath, fixture, baselineLogicalCachePeakBytes: baseline.logicalCachePeakBytes, stagedLogicalCachePeakBytes: staged.logicalCachePeakBytes, logicalPeakReductionBytes: measurement.logicalPeakReductionBytes, cumulativeDeletedBytesPerMode: staged.cumulativeDeletedBytes }));
