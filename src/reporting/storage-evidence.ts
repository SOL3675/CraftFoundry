import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface StorageEvidenceReference { schemaVersion: 1; id: string; file: string; sha256: string }
export interface StorageEvidenceScope { target: string; suite: string; phase?: string }
export interface StorageEvidenceFile { path: string; sha256: string; size: number }
export interface StorageEvidenceManifest {
  schemaVersion: 1; id: string; runId: string; scope: StorageEvidenceScope; sealedAt: string; files: StorageEvidenceFile[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const digest = /^[a-f0-9]{64}$/u;
const scopeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const manifestLimit = 16 * 1024 * 1024;
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

async function noLinks(file: string): Promise<void> {
  let current = path.resolve(file);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Storage evidence refuses links and junctions'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) return; current = parent;
  }
}

function validScope(scope: StorageEvidenceScope): boolean {
  return !!scope && typeof scope === 'object' && !Array.isArray(scope) && keys(scope, ['target', 'suite', 'phase'])
    && typeof scope.target === 'string' && scopeId.test(scope.target) && typeof scope.suite === 'string' && scopeId.test(scope.suite)
    && (scope.phase === undefined || typeof scope.phase === 'string' && scopeId.test(scope.phase));
}
function sourcePath(relative: string): void {
  if (typeof relative !== 'string' || !relative || relative.length > 1024 || /[\\:\u0000-\u001f\u007f]/u.test(relative) || path.isAbsolute(relative)) throw new Error('Invalid storage evidence path');
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.length > 255 || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new Error('Invalid storage evidence path');
  if (parts[0]!.toLowerCase() === 'storage-seals' || parts.some(part => /^(?:report\.json|junit\.xml|tmp|temp|unsealed)$/iu.test(part) || /(?:^\.|\.(?:tmp|part|partial|pending|lock)$)/iu.test(part))) throw new Error('Storage evidence cannot seal mutable reports, temporary files or other seals');
}
async function runDirectory(runRoot: string): Promise<string> {
  await noLinks(runRoot); const root = await realpath(runRoot);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(path.basename(root)) || path.basename(path.dirname(root)) !== 'runs' || path.basename(path.dirname(path.dirname(root))) !== '.harness') throw new Error('Storage evidence requires a retained Run directory');
  if (!(await lstat(root)).isDirectory()) throw new Error('Storage evidence Run is not a directory');
  return root;
}

interface Identity { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function snapshot(root: string, relative: string, includeContent = false): Promise<{ file: StorageEvidenceFile; identity: Identity; content?: Buffer }> {
  const file = path.join(root, ...relative.split('/')); await noLinks(file);
  let before = await lstat(file);
  // Publication briefly has two names within storage-seals; inputs never do.
  if (includeContent) for (let attempt = 0; before.nlink > 1 && attempt < 20; attempt++) { await new Promise(accept => setTimeout(accept, 5)); before = await lstat(file); }
  if (!before.isFile() || before.nlink !== 1 || !Number.isSafeInteger(before.size) || before.size < 0 || includeContent && before.size > manifestLimit) throw new Error('Storage evidence requires bounded regular files without hardlinks');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash('sha256'); const chunks: Buffer[] = []; let bytes = 0;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !same(before, opened)) throw new Error('Storage evidence changed before opening');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > opened.size || includeContent && bytes > manifestLimit) throw new Error('Storage evidence changed while reading');
      hash.update(chunk); if (includeContent) chunks.push(chunk);
    }
    const after = await handle.stat(); await noLinks(file); const named = await lstat(file);
    if (!named.isFile() || named.nlink !== 1 || !same(opened, after) || !same(opened, named) || bytes !== opened.size) throw new Error('Storage evidence changed during snapshot');
    return { file: { path: relative, sha256: hash.digest('hex'), size: bytes }, identity: opened, ...(includeContent ? { content: Buffer.concat(chunks, bytes) } : {}) };
  } finally { await handle.close(); }
}

function validateManifest(value: unknown): asserts value is StorageEvidenceManifest {
  const manifest = value as StorageEvidenceManifest;
  if (!manifest || typeof manifest !== 'object' || !keys(manifest, ['schemaVersion', 'id', 'runId', 'scope', 'sealedAt', 'files']) || manifest.schemaVersion !== 1 || !uuid.test(manifest.id) || typeof manifest.runId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(manifest.runId) || !validScope(manifest.scope) || typeof manifest.sealedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(manifest.sealedAt) || !Number.isFinite(Date.parse(manifest.sealedAt)) || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 100_000) throw new Error('Invalid storage evidence manifest');
  const membership = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object' || !keys(file, ['path', 'sha256', 'size']) || typeof file.path !== 'string' || !digest.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Invalid storage evidence member');
    sourcePath(file.path); const normalized = process.platform === 'win32' ? file.path.toLowerCase() : file.path;
    if (membership.has(normalized)) throw new Error('Duplicate storage evidence membership'); membership.add(normalized);
  }
}

export async function validateStorageEvidenceSeal(runRoot: string, reference: StorageEvidenceReference): Promise<StorageEvidenceManifest> {
  if (!reference || !keys(reference, ['schemaVersion', 'id', 'file', 'sha256']) || reference.schemaVersion !== 1 || !uuid.test(reference.id) || reference.file !== `storage-seals/${reference.id}.json` || !digest.test(reference.sha256)) throw new Error('Invalid storage evidence reference');
  const root = await runDirectory(runRoot);
  const sealed = await snapshot(root, reference.file, true);
  if (sealed.file.sha256 !== reference.sha256) throw new Error('Storage evidence seal SHA-256 mismatch');
  const manifest: unknown = JSON.parse(sealed.content!.toString('utf8')); validateManifest(manifest);
  if (manifest.id !== reference.id || manifest.runId !== path.basename(root)) throw new Error('Storage evidence seal identity does not match the Run');
  const snapshots = [];
  for (const expected of manifest.files) {
    const actual = await snapshot(root, expected.path);
    if (actual.file.sha256 !== expected.sha256 || actual.file.size !== expected.size) throw new Error(`Storage evidence member SHA-256 mismatch: ${expected.path}`);
    snapshots.push(actual);
  }
  // Revalidate every member after the complete set was read. Unrelated Run
  // files can keep changing; every named member must retain its identity.
  for (const original of snapshots) {
    const again = await snapshot(root, original.file.path);
    if (!same(original.identity, again.identity) || again.file.sha256 !== original.file.sha256) throw new Error('Storage evidence membership changed during validation');
  }
  const sealAgain = await snapshot(root, reference.file, true);
  if (!same(sealed.identity, sealAgain.identity) || sealAgain.file.sha256 !== reference.sha256) throw new Error('Storage evidence seal changed during validation');
  return manifest;
}

export async function createStorageEvidenceSeal(projectRoot: string, runRoot: string, options: { scope: StorageEvidenceScope; files: string[] }): Promise<StorageEvidenceReference> {
  await noLinks(projectRoot); const project = await realpath(projectRoot); const root = await runDirectory(runRoot);
  if (path.dirname(path.dirname(path.dirname(root))) !== project) throw new Error('Storage evidence Run escapes project root');
  if (!validScope(options.scope) || !Array.isArray(options.files) || options.files.length < 1 || options.files.length > 100_000) throw new Error('Storage evidence requires a valid scope and at least one file');
  const id = randomUUID(); const reference: StorageEvidenceReference = { schemaVersion: 1, id, file: `storage-seals/${id}.json`, sha256: '' };
  const manifest: StorageEvidenceManifest = { schemaVersion: 1, id, runId: path.basename(root), scope: { ...options.scope }, sealedAt: new Date().toISOString(), files: [] };
  const originals = [];
  for (const file of options.files) { sourcePath(file); const captured = await snapshot(root, file); originals.push(captured); manifest.files.push(captured.file); }
  validateManifest(manifest);
  const content = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (content.length > manifestLimit) throw new Error('Storage evidence manifest exceeds bounded size limit');
  reference.sha256 = createHash('sha256').update(content).digest('hex');
  const directory = path.join(root, 'storage-seals'); await noLinks(directory); await mkdir(directory, { recursive: true });
  const destination = path.join(root, reference.file); const temporary = path.join(directory, `.${id}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try {
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    // Complete membership validation before immutable, non-overwriting publish.
    for (const original of originals) {
      const actual = await snapshot(root, original.file.path);
      if (!same(original.identity, actual.identity) || actual.file.sha256 !== original.file.sha256 || actual.file.size !== original.file.size) throw new Error('Storage evidence changed before seal publication');
    }
    await noLinks(destination); await link(temporary, destination);
  } finally { await unlink(temporary); }
  let directoryHandle;
  try { directoryHandle = await open(directory, 'r'); await directoryHandle.sync(); }
  catch (error) { if (!['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  finally { await directoryHandle?.close(); }
  await validateStorageEvidenceSeal(root, reference);
  return reference;
}
