import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedConfig } from './types.js';
import { assertContainedPath } from './paths.js';

export async function sha256File(file: string): Promise<string> { return createHash('sha256').update(await readFile(file)).digest('hex'); }

/** A URL is never resolved to a latest version; the lock supplies both identity and digest. */
export async function resolveTool(loaded: LoadedConfig, id: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const tool = Object.hasOwn(loaded.lock.tools, id) ? loaded.lock.tools[id] : undefined;
  if (!tool) throw new Error(`Tool ${id} must be pinned in harness.lock.json`);
  const local = loaded.local.tools?.[id];
  if (local) {
    if (await sha256File(local) !== tool.sha256) throw new Error(`Tool hash mismatch: ${id}`);
    return local;
  }
  if (!tool.url?.startsWith('https://')) throw new Error(`Tool ${id} needs a local path or a locked HTTPS URL`);
  const cache = path.join(loaded.root, '.harness', 'cache', 'downloads');
  await assertContainedPath(loaded.root, cache);
  await mkdir(cache, { recursive: true });
  const output = path.join(cache, `${tool.sha256}.jar`);
  await assertContainedPath(loaded.root, output);
  try { if (await sha256File(output) === tool.sha256) return output; throw new Error(`Corrupt cached tool: ${id}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const lockFile = `${output}.lock`;
  await assertContainedPath(loaded.root, lockFile);
  const handle = await open(lockFile, 'wx').catch((error: NodeJS.ErrnoException) => { if (error.code === 'EEXIST') throw new Error(`Download is locked for ${id}; verify the existing owner before retrying`); throw error; });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), id }));
    const response = await fetch(tool.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Tool ${id} download HTTP ${response.status}`);
    const file = await open(temporary, 'wx');
    const hash = createHash('sha256'); let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 512 * 1024 * 1024) throw new Error('Download exceeds the 512 MiB limit');
        hash.update(chunk); await file.write(chunk);
      }
    } finally { await file.close(); }
    if (hash.digest('hex') !== tool.sha256) throw new Error(`Downloaded tool hash mismatch: ${id}`);
    await assertContainedPath(loaded.root, output);
    await rename(temporary, output);
    return output;
  } finally {
    await handle.close(); await unlink(temporary).catch(() => {}); await unlink(lockFile);
  }
}
