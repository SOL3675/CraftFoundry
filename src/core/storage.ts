import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rmdir, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readReport } from '../reporting/report.js';

export interface StorageUnitHandle { id: string; ownerToken: string }
interface FileIdentity { path: string; kind: 'file' | 'directory' | 'link'; bytes: number; modifiedMs?: number; sha256?: string; link?: string }
interface StorageUnit {
  schemaVersion: 1; id: string; ownerHash: string; ownerPid: number; ownerInstance: string; createdAt: string;
  cacheRoot: string; state: 'active' | 'sealed' | 'reclaimed';
  evidenceRoot?: string; sealedAt?: string; evidence?: FileIdentity[]; cache?: FileIdentity[];
}
export interface StorageEntry {
  path: string; kind: FileIdentity['kind']; logicalBytes: number;
  disposition: 'retain' | 'reclaim' | 'deleted'; reason: string; unitId?: string;
}
export interface StorageInventory {
  schemaVersion: 1; measuredAt: string; sizeKind: 'logical'; totalBytes: number;
  availableBytes: number | null; reclaimableBytes: number; retainedBytes: number; entries: StorageEntry[];
}
export interface StorageCleanupResult extends StorageInventory {
  apply: boolean; deletedBytes: number; errors: string[]; auditPath?: string;
}
export interface StorageAudit extends StorageCleanupResult {
  auditSchemaVersion: 1; entryScope: 'selected-managed-units'; complete: boolean;
  /** Every path under root except the listed cache subtrees is retained. */
  retainedScope: { root: '.harness'; exceptCacheRoots: string[]; logicalBytes: number; entryCount: number };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// Never recover a live owner's shutdown authority from a persisted PID/token.
// A restarted process receives another instance even if the OS reuses its PID.
const ownerInstance = randomUUID();
const forbidden = new Set(['world', 'worlds', 'saves', 'config', 'logs', 'crash-reports', 'screenshots', 'report.json', 'results.json', 'junit.xml', 'options.txt', 'servers.dat']);
const relative = (root: string, file: string) => path.relative(root, file).replaceAll('\\', '/');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Unlike general project paths, storage paths never traverse a symlink or junction. */
async function localPath(root: string, supplied: string): Promise<string> {
  const canonical = await realpath(root);
  const absolute = path.resolve(supplied);
  let rel = path.relative(path.resolve(root), absolute);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) rel = path.relative(canonical, absolute);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || !rel) throw new Error('Storage path escapes project root');
  let current = canonical;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Storage path contains a link'); }
    catch (error) { if (!missing(error)) throw error; }
  }
  return path.join(canonical, rel);
}
async function hashFile(file: string): Promise<string> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Storage evidence is not a regular file');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash('sha256');
  try {
    const actual = await handle.stat();
    if (actual.dev !== before.dev || actual.ino !== before.ino || !actual.isFile()) throw new Error('Storage evidence changed before opening');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally { await handle.close(); }
}
async function scan(directory: string, hashes = false, strict = true): Promise<FileIdentity[]> {
  const entries: FileIdentity[] = [];
  async function visit(file: string): Promise<void> {
    let info;
    try { info = await lstat(file); } catch (error) { if (missing(error)) return; throw error; }
    const entryPath = relative(directory, file);
    if (info.isSymbolicLink()) {
      const link = await readlink(file).catch(error => {
        if (!strict && (missing(error) || (error as NodeJS.ErrnoException).code === 'EINVAL')) return undefined;
        throw error;
      });
      if (link !== undefined) entries.push({ path: entryPath, kind: 'link', bytes: 0, link });
      return;
    }
    if (info.isDirectory()) {
      if (entryPath) entries.push({ path: entryPath, kind: 'directory', bytes: 0 });
      const names = await readdir(file).catch(error => { if (!strict && missing(error)) return []; throw error; });
      for (const name of names.sort()) await visit(path.join(file, name));
    } else if (info.isFile()) {
      const item: FileIdentity = { path: entryPath, kind: 'file', bytes: info.size, modifiedMs: info.mtimeMs };
      if (hashes) item.sha256 = await hashFile(file);
      if (strict) {
        const after = await lstat(file);
        if (!after.isFile() || after.isSymbolicLink() || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('Storage file changed during inventory');
      }
      entries.push(item);
    } else throw new Error(`Unsupported storage entry: ${entryPath}`);
  }
  await visit(directory);
  return entries;
}
async function atomicJson(root: string, file: string, data: unknown): Promise<void> {
  file = await localPath(root, file);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(await localPath(root, temporary), 'wx');
  try { await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, await localPath(root, file));
}
const recordFile = (root: string, id: string) => path.join(root, '.harness', 'storage', 'units', `${id}.json`);
const claimFile = (root: string, cacheRoot: string) => path.join(root, '.harness', 'storage', 'claims', `${digest(cacheRoot)}.json`);
function validUnit(value: unknown): value is StorageUnit {
  const unit = value as StorageUnit;
  return !!unit && unit.schemaVersion === 1 && uuid.test(unit.id) && /^[a-f0-9]{64}$/u.test(unit.ownerHash) && Number.isInteger(unit.ownerPid) && uuid.test(unit.ownerInstance)
    && typeof unit.createdAt === 'string' && typeof unit.cacheRoot === 'string'
    && /^\.harness\/c\/[0-9a-f-]+\/mct-cache\/client$/u.test(unit.cacheRoot)
    && uuid.test(unit.cacheRoot.split('/')[2]!)
    && ['active', 'sealed', 'reclaimed'].includes(unit.state);
}
async function readUnit(root: string, id: string): Promise<StorageUnit> {
  if (!uuid.test(id)) throw new Error('Invalid storage unit ID');
  const unit: unknown = JSON.parse(await readFile(await localPath(root, recordFile(root, id)), 'utf8'));
  if (!validUnit(unit) || unit.id !== id) throw new Error('Invalid storage ownership record');
  const claim = JSON.parse(await readFile(await localPath(root, claimFile(root, unit.cacheRoot)), 'utf8'));
  if (claim.id !== unit.id || claim.ownerHash !== unit.ownerHash || claim.ownerInstance !== unit.ownerInstance || claim.cacheRoot !== unit.cacheRoot) throw new Error('Storage ownership claim does not match');
  return unit;
}

/** Register only future isolated dependency directories; existing caches cannot acquire ownership. */
export async function createStorageUnit(projectRoot: string, cacheRoot: string): Promise<StorageUnitHandle> {
  const root = await realpath(projectRoot);
  const cache = await localPath(projectRoot, cacheRoot);
  const rel = relative(root, cache);
  if (!/^\.harness\/c\/[0-9a-f-]+\/mct-cache\/client$/u.test(rel) || !uuid.test(rel.split('/')[2]!)) throw new Error('Storage unit must be an isolated .harness/c/<uuid>/mct-cache/client dependency directory');
  try { await lstat(cache); throw new Error('Existing storage data cannot be adopted'); } catch (error) { if (!missing(error)) throw error; }
  const handle = { id: randomUUID(), ownerToken: randomUUID() };
  const unit: StorageUnit = { schemaVersion: 1, ...{ id: handle.id }, ownerHash: digest(handle.ownerToken), ownerPid: process.pid, ownerInstance, createdAt: new Date().toISOString(), cacheRoot: rel, state: 'active' };
  const claimPath = await localPath(root, claimFile(root, rel));
  await mkdir(path.dirname(claimPath), { recursive: true });
  const claim = await open(claimPath, 'wx');
  try { await claim.writeFile(JSON.stringify({ id: unit.id, ownerHash: unit.ownerHash, ownerInstance, cacheRoot: rel })); await claim.sync(); }
  finally { await claim.close(); }
  await atomicJson(root, recordFile(root, unit.id), unit);
  return handle;
}

function safeCache(items: FileIdentity[]): boolean {
  return items.every(item => item.kind !== 'link' && !item.path.split('/').some(part => forbidden.has(part.toLowerCase())));
}
function sameSnapshot(before: FileIdentity[], after: FileIdentity[], allowRemoved: boolean): boolean {
  const originals = new Map(before.map(item => [item.path, item]));
  return (allowRemoved || before.length === after.length) && after.every(item => {
    const old = originals.get(item.path);
    return old && old.kind === item.kind && old.bytes === item.bytes && old.modifiedMs === item.modifiedMs && old.sha256 === item.sha256 && old.link === item.link;
  });
}
function validSnapshot(value: unknown): value is FileIdentity[] {
  return Array.isArray(value) && value.every(item => item && typeof item.path === 'string' && item.path !== '' && !item.path.split('/').some((part: string) => part === '..' || part === '.') && !path.isAbsolute(item.path) && !item.path.includes('\\') && ['file', 'directory', 'link'].includes(item.kind) && Number.isSafeInteger(item.bytes) && item.bytes >= 0);
}
async function evidenceSnapshot(root: string, evidenceRoot: string): Promise<FileIdentity[]> {
  const directory = await localPath(root, evidenceRoot);
  const rel = relative(root, directory);
  if (!/^\.harness\/runs\/[a-zA-Z0-9_-]+$/u.test(rel)) throw new Error('Storage evidence must be a retained Run directory');
  const report = await readReport(root, path.basename(directory));
  if (!report.finishedAt || !Number.isFinite(Date.parse(report.finishedAt))) throw new Error('Storage evidence report is unfinished');
  const references = [ 'report.json', 'junit.xml', ...(report.source.diffPath ? [report.source.diffPath] : []), ...(report.source.untrackedManifest ? [report.source.untrackedManifest] : []),
    ...report.targets.flatMap(target => [...target.artifacts.map(item => item.path), ...target.suites.flatMap(suite => [...(suite.logs ?? []), ...(suite.evidence ?? [])])]) ];
  for (const reference of references) {
    const file = await localPath(root, path.resolve(directory, reference));
    const within = relative(directory, file);
    if (!within || within === '..' || within.startsWith('../') || path.isAbsolute(within) || !(await lstat(file)).isFile()) throw new Error('Storage evidence reference is not a retained regular Run file');
  }
  // Backend overlays may contain junctions. Record link identities without reading their targets.
  const snapshot = await scan(directory, true);
  for (const reference of references) {
    const file = relative(directory, path.resolve(directory, reference));
    if (!snapshot.some(item => item.path === file && item.kind === 'file')) throw new Error('Storage evidence disappeared during sealing');
  }
  const withoutHashes = snapshot.map(({ sha256: _sha256, ...item }) => item);
  if (!sameSnapshot(withoutHashes, await scan(directory), false)) throw new Error('Storage evidence changed during sealing');
  return snapshot;
}

/** Called only after the runtime has confirmed every owned process stopped and evidence was saved. */
export async function finalizeStorageUnit(projectRoot: string, handle: StorageUnitHandle, proof: { stopped: boolean; evidenceRoot: string }): Promise<void> {
  if (proof.stopped !== true) throw new Error('Storage unit owner has not confirmed shutdown');
  const root = await realpath(projectRoot);
  const unit = await readUnit(root, handle.id);
  if (unit.ownerHash !== digest(handle.ownerToken) || unit.ownerPid !== process.pid || unit.ownerInstance !== ownerInstance || unit.state !== 'active') throw new Error('Storage ownership does not authorize finalization');
  const cache = await localPath(root, path.join(root, unit.cacheRoot));
  const cacheSnapshot = await scan(cache);
  if (!safeCache(cacheSnapshot)) throw new Error('Storage cache contains links or mutable/evidence data');
  const evidenceRoot = await localPath(projectRoot, proof.evidenceRoot);
  const evidence = await evidenceSnapshot(root, evidenceRoot);
  if (!sameSnapshot(cacheSnapshot, await scan(cache), false)) throw new Error('Storage cache changed during evidence sealing');
  await atomicJson(root, recordFile(root, unit.id), { ...unit, state: 'sealed', sealedAt: new Date().toISOString(), evidenceRoot: relative(root, evidenceRoot), evidence, cache: cacheSnapshot });
}

async function unitReason(root: string, unit: StorageUnit): Promise<string | undefined> {
  if (unit.state === 'active') return 'active-or-unconfirmed-owner';
  if (unit.state === 'reclaimed') return 'already-reclaimed';
  if (!unit.sealedAt || !unit.evidenceRoot || !validSnapshot(unit.evidence) || !validSnapshot(unit.cache)) return 'incomplete-evidence-seal';
  try {
    const cache = await scan(await localPath(root, path.join(root, unit.cacheRoot)));
    if (!safeCache(cache)) return 'links-or-mutable-data';
    if (!sameSnapshot(unit.cache, cache, true)) return 'cache-changed-after-shutdown';
    if (!sameSnapshot(unit.evidence, await evidenceSnapshot(root, path.join(root, unit.evidenceRoot)), false)) return 'evidence-changed-or-incomplete';
    return undefined;
  } catch { return 'unverifiable-path-or-evidence'; }
}
async function inventory(projectRoot: string, selected?: string[]): Promise<{ result: StorageInventory; units: StorageUnit[] }> {
  const root = await realpath(projectRoot);
  const harness = await localPath(root, path.join(root, '.harness'));
  const units: StorageUnit[] = [];
  const directory = await localPath(root, path.join(harness, 'storage', 'units'));
  for (const name of await readdir(directory).catch(error => { if (missing(error)) return []; throw error; })) {
    if (!name.endsWith('.json') || !uuid.test(name.slice(0, -5))) continue;
    try { units.push(await readUnit(root, name.slice(0, -5))); } catch { /* Unknown ownership is retained below. */ }
  }
  const reasons = new Map<string, string | undefined>();
  for (const unit of units) reasons.set(unit.id, selected && !selected.includes(unit.id) ? 'not-selected' : await unitReason(root, unit));
  const duplicates = new Set(units.filter((unit, i) => units.some((other, j) => i !== j && other.cacheRoot === unit.cacheRoot)).map(unit => unit.cacheRoot));
  // Logical accounting is a point-in-time estimate: unrelated live runs may append
  // logs or rotate files. Cache eligibility and evidence seals remain strict.
  const entries: StorageEntry[] = (await scan(harness, false, false)).map(item => {
    const itemPath = `.harness/${item.path}`;
    const unit = units.find(candidate => itemPath === candidate.cacheRoot || itemPath.startsWith(`${candidate.cacheRoot}/`));
    const reason = unit ? (duplicates.has(unit.cacheRoot) ? 'conflicting-ownership' : reasons.get(unit.id)) : 'unmarked-or-retained-data';
    return { path: itemPath, kind: item.kind, logicalBytes: item.bytes, disposition: unit && reason === undefined ? 'reclaim' : 'retain', reason: reason ?? 'sealed-stopped-dependencies', ...(unit ? { unitId: unit.id } : {}) };
  });
  const totalBytes = entries.reduce((sum, item) => sum + item.logicalBytes, 0);
  const reclaimableBytes = entries.filter(item => item.disposition === 'reclaim').reduce((sum, item) => sum + item.logicalBytes, 0);
  const availableBytes = await statfs(root).then(info => info.bavail * info.bsize, () => null);
  return { result: { schemaVersion: 1, measuredAt: new Date().toISOString(), sizeKind: 'logical', totalBytes, availableBytes, reclaimableBytes, retainedBytes: totalBytes - reclaimableBytes, entries }, units };
}

export async function inventoryStorage(projectRoot: string): Promise<StorageInventory> { return (await inventory(projectRoot)).result; }

/** Default is a read-only preview. Apply rebuilds the plan under an exclusive project lock. */
export async function cleanupStorage(projectRoot: string, options: { apply?: boolean; unitIds?: string[] } = {}): Promise<StorageCleanupResult> {
  if (options.unitIds?.some(id => !uuid.test(id))) throw new Error('Invalid storage unit ID');
  if (!options.apply) return { ...(await inventory(projectRoot, options.unitIds)).result, apply: false, deletedBytes: 0, errors: [] };
  const root = await realpath(projectRoot);
  const lockFile = await localPath(root, path.join(root, '.harness', 'storage', 'cleanup.lock'));
  await mkdir(path.dirname(lockFile), { recursive: true });
  const lock = await open(lockFile, 'wx').catch((error: NodeJS.ErrnoException) => { if (error.code === 'EEXIST') throw new Error('Storage cleanup is locked; verify its owner before recovering the lock'); throw error; });
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.sync();
    const { result: measured, units } = await inventory(root, options.unitIds);
    const auditPath = `.harness/storage/audits/${randomUUID()}.json`;
    const result: StorageCleanupResult = { ...measured, apply: true, deletedBytes: 0, errors: [], auditPath };
    const auditUnits = units.filter(unit => !options.unitIds || options.unitIds.includes(unit.id));
    const auditUnitIds = new Set(auditUnits.map(unit => unit.id));
    const retainedEntries = measured.entries.filter(entry => !entry.unitId || !auditUnitIds.has(entry.unitId));
    const retainedScope: StorageAudit['retainedScope'] = { root: '.harness', exceptCacheRoots: auditUnits.map(unit => unit.cacheRoot).sort(),
      logicalBytes: retainedEntries.reduce((sum, entry) => sum + entry.logicalBytes, 0), entryCount: retainedEntries.length };
    const saveAudit = async (complete: boolean): Promise<void> => {
      const audit: StorageAudit = { ...result, auditSchemaVersion: 1, entryScope: 'selected-managed-units', complete, retainedScope,
        entries: result.entries.filter(entry => entry.unitId && auditUnitIds.has(entry.unitId)) };
      await atomicJson(root, path.join(root, auditPath), audit);
    };
    await saveAudit(false);
    for (const unit of units.filter(item => measured.entries.some(entry => entry.unitId === item.id && entry.disposition === 'reclaim'))) {
      const reason = await unitReason(root, await readUnit(root, unit.id));
      if (reason) { for (const entry of result.entries.filter(item => item.unitId === unit.id)) { entry.disposition = 'retain'; entry.reason = reason; } continue; }
      try {
        const targets = result.entries.filter(item => item.unitId === unit.id && item.disposition === 'reclaim').sort((a, b) => b.path.split('/').length - a.path.split('/').length);
        for (const entry of targets) {
          const file = await localPath(root, path.join(root, entry.path));
          const info = await lstat(file);
          if (info.isSymbolicLink() || (entry.kind === 'file' ? !info.isFile() : !info.isDirectory())) throw new Error('Storage deletion target changed type');
          if (entry.kind === 'file') {
            const original = unit.cache?.find(item => item.path === relative(path.join(root, unit.cacheRoot), file));
            if (!original || info.size !== original.bytes || info.mtimeMs !== original.modifiedMs) throw new Error('Storage deletion target changed after shutdown');
            await unlink(file); result.deletedBytes += entry.logicalBytes;
          } else await rmdir(file);
          entry.disposition = 'deleted'; entry.reason = 'sealed-stopped-dependencies';
        }
        await atomicJson(root, recordFile(root, unit.id), { ...unit, state: 'reclaimed' });
      } catch (error) {
        result.errors.push(`${unit.id}: ${(error as Error).message}`);
        for (const entry of result.entries.filter(item => item.unitId === unit.id && item.disposition === 'reclaim')) {
          entry.disposition = 'retain'; entry.reason = 'deletion-failed-retry-available';
        }
      }
      // A failure here leaves the durable pre-deletion audit; a later retry validates the remaining subset.
      await saveAudit(false);
    }
    result.reclaimableBytes = result.entries.filter(item => item.disposition === 'reclaim').reduce((sum, item) => sum + item.logicalBytes, 0);
    result.retainedBytes = result.entries.filter(item => item.disposition === 'retain').reduce((sum, item) => sum + item.logicalBytes, 0);
    await saveAudit(true);
    return result;
  } finally { await lock.close(); await unlink(await localPath(root, lockFile)); }
}
