import { harnessVersion } from '../core/version.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LoadedConfig } from '../core/types.js';
import type { RunReport } from './types.js';
import { redact } from './redact.js';
import { redactText } from './redact.js';
import { Ajv } from 'ajv';
import { readFileSync } from 'node:fs';
import { assertContainedPath } from '../core/paths.js';
import { summarizeText } from './summary.js';
import { validateCaseDetails } from './result-details.js';
import { validateStorageEvidenceSeal } from './storage-evidence.js';
import type { StorageEvidenceReference } from './storage-evidence.js';

const execute = promisify(execFile);
const validateReport = new Ajv({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(new URL('../../schemas/run.schema.json', import.meta.url), 'utf8')));
export async function createRun(loaded: LoadedConfig, command: string): Promise<{ report: RunReport; directory: string }> {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(loaded.root, '.harness', 'runs', id);
  await assertContainedPath(loaded.root, directory);
  await mkdir(directory, { recursive: true });
  await assertContainedPath(loaded.root, directory);
  const source: RunReport['source'] = { limitations: [] };
  try {
    const options = { cwd: loaded.root, windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 };
    const ignored = await execute('git', ['check-ignore', '-q', '--', '.'], options).then(() => true, (error: { code?: number }) => {
      if (error.code === 1) return false;
      throw error;
    });
    if (ignored) {
      source.limitations.push('The project directory is ignored by its parent Git repository. Its revision does not identify the project sources; preserve the project files.');
      throw new Error('Ignored project source');
    }
    source.revision = (await execute('git', ['rev-parse', 'HEAD'], options)).stdout.trim();
    const diff = (await execute('git', ['diff', '--binary', 'HEAD', '--', '.', ':!.ai', ':!.ai/**'], options)).stdout;
    const untracked = (await execute('git', ['ls-files', '--others', '--exclude-standard', '-z'], options)).stdout.split('\0').filter(file => file && !file.startsWith('.ai/'));
    source.dirty = diff.length > 0 || untracked.length > 0;
    source.diffSha256 = createHash('sha256').update(diff).digest('hex');
    if (diff.length) {
      const patch = redactText(diff);
      source.diffPath = 'source.patch'; await writeFile(path.join(directory, source.diffPath), patch);
      if (patch !== diff) source.limitations.push('The archived working-tree patch was redacted and cannot reconstruct all original source bytes.');
    }
    if (untracked.length) {
      const identities = await Promise.all(untracked.map(async file => {
        try {
          const source = path.resolve(loaded.root, file);
          await assertContainedPath(loaded.root, source);
          return { path: file.replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(source)).digest('hex') };
        }
        catch { return { path: file.replaceAll('\\', '/'), unavailable: true }; }
      }));
      const data = JSON.stringify(identities, null, 2) + '\n';
      source.untrackedManifest = 'source-files.json'; source.untrackedSha256 = createHash('sha256').update(data).digest('hex');
      await writeFile(path.join(directory, source.untrackedManifest), data);
      source.limitations.push(`${untracked.length} untracked source file(s) are identified by hashes but not archived. Preserve the working tree to reproduce this run.`);
    }
  } catch {
    source.limitations.push('Git source identity could not be collected.');
  }
  const report: RunReport = {
    schemaVersion: 1, id, command, startedAt: new Date().toISOString(), status: 'infrastructure-error',
    harnessVersion, platform: { os: process.platform, arch: process.arch, node: process.version },
    source, configuration: redact(loaded.config), lock: loaded.lock, targets: [],
    reproduction: { command, limitations: [...source.limitations] },
  };
  await saveReport(directory, report);
  return { report, directory };
}

export async function saveReport(directory: string, report: RunReport): Promise<void> {
  await withReportWriteLock(directory, async () => {
    const latest = await existingReport(directory);
    if (latest && latest.id !== report.id) throw new Error('Existing Run report identity does not match');
    const references = mergeStorageEvidence(latest?.storageEvidence ?? [], report.storageEvidence ?? []);
    const candidate = { ...report, ...(references.length ? { storageEvidence: references } : {}) };
    await writeReport(directory, candidate);
    if (references.length) report.storageEvidence = references;
  });
}

/** Append completed scope evidence without overwriting the parent's ongoing report. */
export async function attachStorageEvidence(projectRoot: string, runRoot: string, references: StorageEvidenceReference[]): Promise<void> {
  await assertContainedPath(projectRoot, runRoot);
  const project = await realpath(projectRoot); const directory = await realpath(runRoot);
  if (path.dirname(path.dirname(path.dirname(directory))) !== project || path.basename(path.dirname(directory)) !== 'runs' || path.basename(path.dirname(path.dirname(directory))) !== '.harness') throw new Error('Storage evidence attachment requires a project Run');
  if (!Array.isArray(references) || references.length < 1) throw new Error('Storage evidence attachment requires at least one reference');
  await withReportWriteLock(directory, async () => {
    const latest = await existingReport(directory);
    if (!latest || latest.id !== path.basename(directory)) throw new Error('Storage evidence attachment requires an existing matching Run report');
    latest.storageEvidence = mergeStorageEvidence(latest.storageEvidence ?? [], references);
    await writeReport(directory, latest);
  });
}

async function existingReport(directory: string): Promise<RunReport | undefined> {
  try {
    const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')) as RunReport;
    if (!validateReport(report)) throw new Error('Invalid existing Run report');
    return report;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

function mergeStorageEvidence(existing: StorageEvidenceReference[], incoming: StorageEvidenceReference[]): StorageEvidenceReference[] {
  const references = new Map<string, StorageEvidenceReference>();
  for (const reference of [...existing, ...incoming]) {
    const prior = references.get(reference.id);
    if (prior && (prior.file !== reference.file || prior.sha256 !== reference.sha256 || prior.schemaVersion !== reference.schemaVersion)) throw new Error('Conflicting storage evidence reference');
    references.set(reference.id, reference);
  }
  return [...references.values()];
}

async function withReportWriteLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const file = path.join(directory, 'report.write.lock'); await assertContainedPath(directory, file);
  let lock;
  for (let attempt = 0; ; attempt++) {
    try { lock = await open(file, 'wx'); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt >= 100) throw new Error('Run report write is locked; verify its owner before retrying');
      await new Promise(accept => setTimeout(accept, 50));
    }
  }
  const owned = await lock.stat();
  try {
    await lock.writeFile(JSON.stringify({ schemaVersion: 1, owner: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() })); await lock.sync();
    return await operation();
  } finally {
    await lock.close();
    const current = await lstat(file);
    if (current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino) throw new Error('Run report write lock ownership changed');
    await unlink(file);
  }
}

async function writeReport(directory: string, report: RunReport): Promise<void> {
  const safe = redact(report);
  if (!validateReport(safe)) throw new Error(`Invalid run report: ${JSON.stringify(validateReport.errors)}`);
  await validateCaseDetails((safe as RunReport).targets.flatMap(target => target.suites.flatMap(suite => suite.cases)), directory);
  await validateStorageEvidence(directory, safe as RunReport);
  await atomicReportText(directory, 'report.json', `${JSON.stringify(safe, null, 2)}\n`);
  await atomicReportText(directory, 'junit.xml', toJUnit(report));
}

async function atomicReportText(directory: string, name: string, content: string): Promise<void> {
  const temporary = path.join(directory, `${name}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try {
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path.join(directory, name));
    // Windows and some filesystems cannot open/flush directory handles through
    // Node. File data is synced; this is not a full power-loss durability claim.
    let directoryHandle;
    try { directoryHandle = await open(directory, 'r'); await directoryHandle.sync(); }
    catch (error) { if (!['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    finally { await directoryHandle?.close(); }
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}

export async function readReport(root: string, id: string): Promise<RunReport> {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid run ID');
  const actualRoot = await realpath(root);
  const actualFile = await realpath(path.join(actualRoot, '.harness', 'runs', id, 'report.json'));
  const relative = path.relative(actualRoot, actualFile);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('Report path escapes project root');
  const report = JSON.parse(await readFile(actualFile, 'utf8')) as RunReport;
  if (!validateReport(report) || report.id !== id) throw new Error('Invalid run report');
  const directory = path.dirname(actualFile);
  await validateCaseDetails(report.targets.flatMap(target => target.suites.flatMap(suite => suite.cases)), directory);
  await validateStorageEvidence(directory, report);
  return report;
}

async function validateStorageEvidence(directory: string, report: RunReport): Promise<void> {
  const seen = new Set<string>();
  for (const reference of report.storageEvidence ?? []) {
    if (seen.has(reference.id)) throw new Error('Duplicate storage evidence reference'); seen.add(reference.id);
    const manifest = await validateStorageEvidenceSeal(directory, reference);
    if (manifest.runId !== report.id) throw new Error('Storage evidence Run identity does not match report');
  }
}

function escapeXml(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}
function diagnosticXml(text: string, reference: string, detail?: { file: string; pointer: string }): string {
  const summary = summarizeText(text, 1800);
  const full = detail ? `${detail.file}#${detail.pointer}` : text !== summary ? `report.json#${reference}` : undefined;
  return escapeXml(`${summary}${full ? `; Detail: ${full}` : ''}`);
}
export function toJUnit(report: RunReport): string {
  report = redact(report) as RunReport;
  const suites = report.targets.flatMap((target, targetIndex) => target.suites.map((suite, suiteIndex) => {
    const cases = suite.cases.length ? [...suite.cases] : [{ id: suite.id, status: suite.status, message: suite.error }];
    if (suite.status !== 'passed' && cases.every(test => test.status === 'passed')) cases.push({ id: `${suite.id}.harness-gate`, status: suite.status, message: suite.error ?? 'Suite acceptance conditions were not met' });
    const counts = { failed: 0, error: 0, skipped: 0 };
    const lines = cases.map((test, caseIndex) => {
      const original = test.message ?? suite.error ?? test.status;
      const reference = `/targets/${targetIndex}/suites/${suiteIndex}/${caseIndex < suite.cases.length && test.message !== undefined ? `cases/${caseIndex}/message` : 'error'}`;
      const message = diagnosticXml(original, reference, test.detail);
      let body = '';
      if (test.status === 'failed') { counts.failed++; body = `<failure message="${message}"/>`; }
      else if (test.status === 'infrastructure-error' || (suite.required && ['unsupported', 'skipped'].includes(test.status))) {
        counts.error++; body = `<error message="${message}"/>`;
      } else if (test.status !== 'passed') { counts.skipped++; body = `<skipped message="${message}"/>`; }
      return `<testcase classname="${escapeXml(target.id)}" name="${escapeXml(test.id)}" time="${(test.durationMs ?? 0) / 1000}">${body}</testcase>`;
    });
    return `<testsuite name="${escapeXml(`${target.id}/${suite.id}`)}" tests="${cases.length}" failures="${counts.failed}" errors="${counts.error}" skipped="${counts.skipped}">${lines.join('')}</testsuite>`;
  }));
  for (const [targetIndex, target] of report.targets.entries()) {
    if (target.status !== 'passed' && !target.suites.some(suite => suite.status !== 'passed')) {
      suites.push(`<testsuite name="${escapeXml(target.id)}" tests="1" errors="1"><testcase name="target-gate"><error message="${diagnosticXml(target.error ?? target.status, `/targets/${targetIndex}/error`)}"/></testcase></testsuite>`);
    }
  }
  // A preflight/build failure must remain visible to CI even when no suite was started.
  if (!suites.length && report.status !== 'passed') {
    const failedTarget = report.targets.findIndex(t => t.error !== undefined);
    suites.push(`<testsuite name="harness" tests="1" errors="1"><testcase name="run"><error message="${diagnosticXml(report.error ?? report.targets[failedTarget]?.error ?? report.status, report.error !== undefined ? '/error' : `/targets/${failedTarget}/error`)}"/></testcase></testsuite>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${suites.join('')}</testsuites>\n`;
}
