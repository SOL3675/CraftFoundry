import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const fileLimit = 16 * 1024 * 1024;
const totalLimit = 64 * 1024 * 1024;
interface Identity { dev: number; ino: number; nlink: number; size: number; mtimeMs: number; ctimeMs: number }
interface Member { relative: string; identity: Identity }
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function noLinks(file: string): Promise<void> {
  let current = path.resolve(file);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Dependency metadata refuses links and junctions'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) return; current = parent;
  }
}
function regular(info: Awaited<ReturnType<typeof lstat>>, source = false): void {
  if (!info.isFile() || (source ? info.nlink < 1 : info.nlink !== 1) || !Number.isSafeInteger(info.size) || info.size < 0 || info.size > fileLimit) throw new Error('Dependency metadata requires bounded regular JSON files and independent retained copies');
}
function safeName(name: string): void {
  if (!name || name === '.' || name === '..' || name.length > 255 || /[\\/:\u0000-\u001f\u007f]/u.test(name) || /[. ]$/u.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) throw new Error('Unexpected dependency metadata path');
}

async function members(cache: string): Promise<Member[]> {
  const selected: Member[] = []; let total = 0; let visited = 0;
  const entries = async (directory: string) => {
    await noLinks(directory);
    try {
      if (!(await lstat(directory)).isDirectory()) throw new Error('Dependency metadata selection is not a directory');
      return await readdir(directory, { withFileTypes: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  };
  const select = async (file: string) => {
    await noLinks(file); const info = await lstat(file); regular(info, true);
    total += info.size;
    if (selected.length >= 256 || total > totalLimit) throw new Error('Dependency metadata exceeds file count or total size limit');
    selected.push({ relative: path.relative(cache, file).replaceAll('\\', '/'), identity: info });
  };
  const versions = async (directory: string, depth: number): Promise<void> => {
    if (depth > 16) throw new Error('Dependency metadata exceeds directory depth limit');
    for (const entry of await entries(directory)) {
      safeName(entry.name); if (++visited > 100_000) throw new Error('Dependency metadata exceeds directory entry limit');
      const file = path.join(directory, entry.name); await noLinks(file); const info = await lstat(file);
      if (info.isDirectory()) {
        if (entry.name === 'natives' || entry.name.endsWith('-natives')) continue;
        if (entry.name.startsWith('.') || ['world', 'worlds', 'saves', 'config', 'logs', 'assets', 'objects'].includes(entry.name.toLowerCase())) throw new Error('Unexpected mutable dependency metadata directory');
        await versions(file, depth + 1);
      }
      else if (!info.isFile() || info.nlink !== 1 && !entry.name.endsWith('.json')) throw new Error('Unexpected linked or nonregular dependency metadata entry');
      else if (entry.name.endsWith('.json') && !entry.name.startsWith('.')) await select(file);
    }
  };
  for (const runtime of await entries(path.join(cache, 'client', 'runtime'))) {
    safeName(runtime.name);
    if (!/^\d+\.\d+(?:\.\d+)?$/u.test(runtime.name) || !runtime.isDirectory() || runtime.isSymbolicLink()) throw new Error('Unexpected managed Minecraft runtime metadata path');
    const root = path.join(cache, 'client', 'runtime', runtime.name); await noLinks(root);
    await versions(path.join(root, 'versions'), 0);
    for (const entry of await entries(path.join(root, 'assets', 'indexes'))) {
      safeName(entry.name);
      const file = path.join(root, 'assets', 'indexes', entry.name); await noLinks(file); const info = await lstat(file);
      if (!info.isFile() || info.nlink !== 1 && !entry.name.endsWith('.json')) throw new Error('Unexpected dependency asset index entry');
      if (entry.name.endsWith('.json') && !entry.name.startsWith('.')) await select(file);
    }
  }
  return selected.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function hashRegular(file: string, expected: Identity, source = false): Promise<string> {
  await noLinks(file); const before = await lstat(file); regular(before, source);
  if (!same(before, expected)) throw new Error('Dependency metadata changed before verification');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat(); regular(opened, source);
    if (!same(before, opened)) throw new Error('Dependency metadata changed before opening');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > opened.size || bytes > fileLimit) throw new Error('Dependency metadata changed during verification'); hash.update(chunk); }
    const after = await handle.stat(); await noLinks(file); const named = await lstat(file); regular(named, source);
    if (!same(opened, after) || !same(opened, named) || bytes !== opened.size) throw new Error('Dependency metadata changed during verification');
    return hash.digest('hex');
  } finally { await handle.close(); }
}

/** Copy available metadata after confirmed shutdown; this does not attest installation completeness or upstream provenance. */
export async function retainClientDependencyMetadata(projectRoot: string, cacheDir: string, runRoot: string): Promise<string[]> {
  await noLinks(projectRoot); const project = await realpath(projectRoot);
  await noLinks(cacheDir); const cache = await realpath(cacheDir); const cacheRelative = path.relative(project, cache).replaceAll('\\', '/');
  if (!/^\.harness\/c\/[0-9a-f-]+\/mct-cache$/u.test(cacheRelative) || !uuid.test(cacheRelative.split('/')[2]!)) throw new Error('Dependency metadata requires an isolated project-managed cache');
  await noLinks(runRoot); const run = await realpath(runRoot);
  if (path.dirname(path.dirname(path.dirname(run))) !== project || path.basename(path.dirname(run)) !== 'runs' || path.basename(path.dirname(path.dirname(run))) !== '.harness' || !/^[A-Za-z0-9_-]{1,128}$/u.test(path.basename(run))) throw new Error('Dependency metadata requires a retained project Run');
  const selected = await members(cache);
  if (!selected.length) return [];
  const destinationRoot = path.join(run, 'storage-dependencies', randomUUID()); await noLinks(destinationRoot); await mkdir(destinationRoot, { recursive: true });
  const retained: string[] = []; const hashes = new Map<string, string>(); const copies = new Map<string, { file: string; identity: Identity }>();
  for (const member of selected) {
    const source = path.join(cache, ...member.relative.split('/')); await noLinks(source);
    const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await input.stat(); regular(before, true);
      if (!same(before, member.identity)) throw new Error('Dependency metadata changed before copying');
      const destination = path.join(destinationRoot, ...member.relative.split('/')); await noLinks(destination); await mkdir(path.dirname(destination), { recursive: true });
      const output = await open(destination, 'wx'); const hash = createHash('sha256'); let bytes = 0;
      try {
        for await (const chunk of input.createReadStream({ autoClose: false })) {
          bytes += chunk.length; if (bytes > before.size || bytes > fileLimit) throw new Error('Dependency metadata changed during copy');
          hash.update(chunk); await output.writeFile(chunk);
        }
        await output.sync();
      } finally { await output.close(); }
      const after = await input.stat(); await noLinks(source); const named = await lstat(source); regular(named, true);
      if (!same(before, after) || !same(before, named) || bytes !== before.size) throw new Error('Dependency metadata changed during copy');
      const sha256 = hash.digest('hex'); hashes.set(member.relative, sha256);
      const copied = await lstat(destination); regular(copied);
      if (await hashRegular(destination, copied) !== sha256) throw new Error('Retained dependency metadata SHA-256 mismatch');
      copies.set(member.relative, { file: destination, identity: copied });
      retained.push(path.relative(run, destination).replaceAll('\\', '/'));
    } finally { await input.close(); }
  }
  const again = await members(cache);
  if (again.length !== selected.length || again.some((member, index) => member.relative !== selected[index]!.relative || !same(member.identity, selected[index]!.identity))) throw new Error('Dependency metadata membership changed during retention');
  for (const member of selected) {
    if (await hashRegular(path.join(cache, ...member.relative.split('/')), member.identity, true) !== hashes.get(member.relative)) throw new Error('Source dependency metadata SHA-256 changed');
    const copied = copies.get(member.relative)!;
    if (await hashRegular(copied.file, copied.identity) !== hashes.get(member.relative)) throw new Error('Retained dependency metadata SHA-256 changed');
  }
  return retained;
}
