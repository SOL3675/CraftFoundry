import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface SharedAssetStats {
  importedFiles: number;
  importedBytes: number;
  reusedFiles: number;
  clonedFiles: number;
  clonedBytes: number;
  copiedFiles: number;
  copiedBytes: number;
}
type Kind = 'objects' | 'indexes';
const marker = 'craft-foundry-shared-assets-v1\n';
const cloneUnsupported = new Set(['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EINVAL', 'ENOTTY']);

/** Refuse junctions/symlinks, including existing ancestors, before creating managed files. */
async function noLinks(path: string): Promise<void> {
  let current = resolve(path);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Shared assets refuse symbolic links and junctions'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}

function validate(kind: Kind, name: string, content: Buffer): void {
  const hash = kind === 'indexes' ? name.slice(0, -5) : name;
  if (!(kind === 'indexes' ? /^[a-f0-9]{40}\.json$/u : /^[a-f0-9]{40}$/u).test(name)) throw new Error('Invalid shared asset identity');
  if (content.length > (kind === 'indexes' ? 16 : 128) * 1024 * 1024) throw new Error('Shared asset exceeds bounded size limit');
  if (createHash('sha1').update(content).digest('hex') !== hash) throw new Error(`Shared asset SHA-1 mismatch: ${name}`);
  if (kind === 'indexes') {
    const index = JSON.parse(content.toString('utf8')) as { objects?: Record<string, { hash?: string; size?: number }> };
    if (!index.objects || typeof index.objects !== 'object' || Array.isArray(index.objects) || Object.keys(index.objects).length > 100_000 || Object.values(index.objects).some(item => !item || typeof item.hash !== 'string' || !/^[a-f0-9]{40}$/u.test(item.hash) || !Number.isSafeInteger(item.size) || item.size! < 0)) throw new Error('Invalid shared asset index');
  }
}

async function contentAt(path: string, kind: Kind, name: string): Promise<Buffer> {
  await noLinks(path);
  let before = await lstat(path);
  // Another publisher may have linked its finished temporary file immediately
  // before removing that private name. Allow that bounded transition only.
  for (let attempt = 0; before.nlink > 1 && attempt < 20; attempt++) {
    await new Promise(accept => setTimeout(accept, 5)); before = await lstat(path);
  }
  const limit = (kind === 'indexes' ? 16 : 128) * 1024 * 1024;
  if (!before.isFile() || before.nlink !== 1 || before.size > limit) throw new Error('Shared assets require bounded regular files with one owner');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) throw new Error('Shared asset changed before opening');
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > limit) throw new Error('Shared asset exceeds bounded size limit');
      chunks.push(chunk);
    }
    const after = await handle.stat(); await noLinks(path); const named = await lstat(path);
    if (!named.isFile() || named.nlink !== 1 || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || named.dev !== opened.dev || named.ino !== opened.ino || named.size !== opened.size || named.mtimeMs !== opened.mtimeMs || bytes !== opened.size) throw new Error('Shared asset changed during verification');
    const content = Buffer.concat(chunks, bytes); validate(kind, name, content); return content;
  } finally { await handle.close(); }
}

/**
 * Only SHA-1 addressed Minecraft asset objects and original addressed indexes.
 * Each game receives its own inode: clones provide copy-on-write isolation;
 * unsupported filesystems receive verified copies, never writable hardlinks.
 * The caller must supply a project-owned root. No old session is changed.
 */
export class SharedAssets {
  readonly stats: SharedAssetStats = { importedFiles: 0, importedBytes: 0, reusedFiles: 0, clonedFiles: 0, clonedBytes: 0, copiedFiles: 0, copiedBytes: 0 };
  readonly root: string;
  private signal?: AbortSignal;
  constructor(root: string, signal?: AbortSignal) {
    if (!isAbsolute(root)) throw new Error('Shared assets require an absolute project-owned root');
    this.root = resolve(root);
    this.signal = signal;
  }

  async initialize(): Promise<void> {
    this.signal?.throwIfAborted(); await noLinks(this.root); await mkdir(this.root, { recursive: true });
    const identity = join(this.root, 'OWNER'); await noLinks(identity);
    try { if (!(await lstat(identity)).isFile() || await readFile(identity, 'utf8') !== marker) throw new Error('Unrecognized shared asset cache owner'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if ((await readdir(this.root)).some(name => name !== 'OWNER' && !/^\.owner-[a-f0-9-]+\.tmp$/u.test(name))) throw new Error('Refusing an unowned shared asset cache');
      await this.publish(identity, Buffer.from(marker));
      if (await readFile(identity, 'utf8') !== marker) throw new Error('Unrecognized shared asset cache owner');
    }
  }

  private path(kind: Kind, name: string): string { return kind === 'objects' ? join(this.root, kind, name.slice(0, 2), name) : join(this.root, kind, name); }

  private async publish(destination: string, content: Buffer): Promise<boolean> {
    await noLinks(destination); await mkdir(dirname(destination), { recursive: true });
    const temporary = join(dirname(destination), `${destination.endsWith('OWNER') ? '.owner' : '.asset'}-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx');
    try {
      try { await handle.writeFile(content); await handle.sync(); }
      finally { await handle.close(); }
      this.signal?.throwIfAborted(); await noLinks(destination);
      // Same-cache hardlink publication is atomic and cannot overwrite a winner.
      // The temporary name is removed before exposing the file to a session.
      try { await link(temporary, destination); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return false; }
    } finally { await unlink(temporary); }
  }

  async retain(kind: Kind, name: string, content: Buffer): Promise<string> {
    this.signal?.throwIfAborted(); validate(kind, name, content);
    const destination = this.path(kind, name);
    try { await contentAt(destination, kind, name); this.stats.reusedFiles++; return destination; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const imported = await this.publish(destination, content);
    await contentAt(destination, kind, name);
    if (imported) { this.stats.importedFiles++; this.stats.importedBytes += content.length; } else this.stats.reusedFiles++;
    return destination;
  }

  async materialize(kind: Kind, name: string, content: Buffer, destination: string): Promise<void> {
    const source = await this.retain(kind, name, content);
    await noLinks(destination); await mkdir(dirname(destination), { recursive: true });
    try { await contentAt(destination, kind, name); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.signal?.throwIfAborted();
    let cloned = true;
    try { await copyFile(source, destination, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE); }
    catch (error) {
      if (!cloneUnsupported.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      cloned = false; await copyFile(source, destination, constants.COPYFILE_EXCL);
    }
    await contentAt(destination, kind, name);
    if (cloned) { this.stats.clonedFiles++; this.stats.clonedBytes += content.length; }
    else { this.stats.copiedFiles++; this.stats.copiedBytes += content.length; }
  }

  private async visit(assetsRoot: string, accept: (kind: Kind, name: string, content: Buffer) => Promise<void>): Promise<void> {
    await noLinks(assetsRoot); await noLinks(join(assetsRoot, 'objects')); await noLinks(join(assetsRoot, 'indexes')); let count = 0;
    const entries = async (path: string) => readdir(path, { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; });
    for (const prefix of await entries(join(assetsRoot, 'objects'))) {
      if (!/^[a-f0-9]{2}$/u.test(prefix.name)) continue;
      if (!prefix.isDirectory() || prefix.isSymbolicLink()) throw new Error('Shared asset prefix must be a regular directory');
      for (const entry of await entries(join(assetsRoot, 'objects', prefix.name))) {
        if (!/^[a-f0-9]{40}$/u.test(entry.name) || !entry.name.startsWith(prefix.name)) continue;
        this.signal?.throwIfAborted(); if (++count > 100_000) throw new Error('Shared assets exceed bounded object limit');
        await accept('objects', entry.name, await contentAt(join(assetsRoot, 'objects', prefix.name, entry.name), 'objects', entry.name));
      }
    }
    for (const entry of await entries(join(assetsRoot, 'indexes'))) {
      if (!/^[a-f0-9]{40}\.json$/u.test(entry.name)) continue;
      this.signal?.throwIfAborted(); if (++count > 100_000) throw new Error('Shared assets exceed bounded object limit');
      await accept('indexes', entry.name, await contentAt(join(assetsRoot, 'indexes', entry.name), 'indexes', entry.name));
    }
  }

  async seed(assetsRoot: string): Promise<void> {
    await this.visit(this.root, async (kind, name, content) => {
      const destination = kind === 'objects' ? join(assetsRoot, kind, name.slice(0, 2), name) : join(assetsRoot, kind, name);
      await this.materialize(kind, name, content, destination);
    });
  }

  async capture(assetsRoot: string): Promise<void> {
    await this.visit(assetsRoot, async (kind, name, content) => { await this.retain(kind, name, content); });
  }
}
