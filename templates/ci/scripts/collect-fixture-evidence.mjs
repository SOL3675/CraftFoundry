import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertContainedPath } from '../../dist/core/paths.js';
import { validateCaseDetails } from '../../dist/reporting/result-details.js';
import { validateStorageEvidenceSeal } from '../../dist/reporting/storage-evidence.js';

export async function collectFixtureEvidence(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const output = path.join(root, '.harness/ci/evidence');
  await assertContainedPath(root, output);
  await mkdir(output, { recursive: true });
  let count = 0;
  const copy = async (source, relative) => {
    await assertContainedPath(root, source);
    const destination = path.join(output, relative);
    await assertContainedPath(output, destination);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination); count++;
  };
  const entries = async directory => {
    try { await assertContainedPath(root, directory); return await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const tree = async (directory, relative) => {
    for (const entry of await entries(directory)) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name), target = path.join(relative, entry.name);
      if (entry.isDirectory()) await tree(file, target);
      else if (entry.isFile()) await copy(file, target);
    }
  };
  const diagnostics = path.join(root, '.harness/ci');
  for (const entry of await entries(diagnostics)) if (entry.isFile() && /\.(?:json|log)$/.test(entry.name)) await copy(path.join(diagnostics, entry.name), path.join('ci', entry.name));
  const runs = path.join(root, '.harness/runs');
  for (const run of await entries(runs)) {
    if (!run.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(run.name)) continue;
    const directory = path.join(runs, run.name), relative = path.join('runs', run.name);
    for (const entry of await entries(directory)) if (entry.isFile() && ['report.json', 'junit.xml', 'source.patch', 'source-files.json'].includes(entry.name)) await copy(path.join(directory, entry.name), path.join(relative, entry.name));
    await tree(path.join(directory, 'logs'), path.join(relative, 'logs'));
    // These are declared, hash-snapshotted Mod artifacts; Minecraft runtime/cache JARs are elsewhere.
    await tree(path.join(directory, 'artifacts'), path.join(relative, 'artifacts'));
    let report;
    try {
      await assertContainedPath(directory, path.join(directory, 'report.json'));
      report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
    }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) report = {}; else throw error; }
    if (!report || typeof report !== 'object') report = {};
    // Scoped seals authorize exact retained files independently of extension.
    // They never authorize copying a runtime/cache/world directory wholesale.
    if (report.storageEvidence !== undefined && !Array.isArray(report.storageEvidence)) throw new Error('Invalid storage evidence references');
    const sealed = [];
    for (const reference of report.storageEvidence ?? []) {
      const manifest = await validateStorageEvidenceSeal(directory, reference);
      sealed.push({ reference, manifest });
      await copy(path.join(directory, reference.file), path.join(relative, reference.file));
      for (const file of manifest.files) await copy(path.join(directory, file.path), path.join(relative, file.path));
    }
    const detailFiles = await validateCaseDetails((report.targets ?? []).flatMap(target => (target.suites ?? []).flatMap(suite => suite.cases ?? [])), directory);
    const detailPaths = new Set(detailFiles.map(file => path.relative(directory, file).replaceAll('\\', '/')));
    const evidence = new Set((report.targets ?? []).flatMap(target => (target.suites ?? []).flatMap(suite => [...(suite.logs ?? []), ...(suite.evidence ?? [])])));
    for (const file of detailFiles) await copy(file, path.join(relative, path.relative(directory, file)));
    for (const item of evidence) {
      if (detailPaths.has(item)) continue; // Already copied once after mandatory validation.
      if (typeof item !== 'string' || !item.startsWith('sessions/') || !/\.(?:log|png|json|properties|txt)$/.test(item)) continue;
      await assertContainedPath(directory, path.join(directory, item));
      try { await copy(path.join(directory, item), path.join(relative, item)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const scanSession = async directoryToScan => {
      for (const entry of await entries(directoryToScan)) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(directoryToScan, entry.name);
        if (entry.isDirectory()) {
          if (!['mct-cache', 'backend-overlay', 'world', 'world_nether', 'world_the_end', 'mods', 'assets', 'libraries', 'node_modules'].includes(entry.name)) await scanSession(file);
        } else if (entry.isFile() && (/\.(?:log|png)$/.test(entry.name) || /(?:^|[/\\])crash-reports[/\\].*\.txt$/.test(file))) {
          await copy(file, path.join(relative, path.relative(directory, file)));
        }
      }
    };
    await scanSession(path.join(directory, 'sessions'));
    // Catch changes during export and verify the exported bytes themselves,
    // including files that the ordinary salvage pass may also have copied.
    for (const { reference, manifest } of sealed) {
      await validateStorageEvidenceSeal(directory, reference);
      for (const file of [{ path: reference.file, sha256: reference.sha256 }, ...manifest.files]) {
        const destination = path.join(output, relative, file.path);
        await assertContainedPath(output, destination);
        const hash = createHash('sha256'); let bytes = 0;
        for await (const chunk of createReadStream(destination)) { hash.update(chunk); bytes += chunk.length; }
        if (hash.digest('hex') !== file.sha256 || file.size !== undefined && bytes !== file.size) throw new Error(`Exported storage evidence changed: ${file.path}`);
      }
    }
  }
  console.log(JSON.stringify({ evidenceDirectory: '.harness/ci/evidence', files: count }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await collectFixtureEvidence();
