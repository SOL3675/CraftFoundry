import { lstat, open, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertContainedPath } from '../core/paths.js';
import { redactText } from './redact.js';

/** Retain Java crash reports without following game-created links outside the session. */
export async function collectCrashReports(root: string): Promise<string[]> {
  const directory = path.join(root, 'crash-reports');
  try {
    if (!(await lstat(directory)).isDirectory()) return [];
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  await assertContainedPath(root, directory);
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.txt')) continue;
    const file = path.join(directory, entry.name);
    await assertContainedPath(root, file);
    const handle = await open(file, 'r');
    let text: string;
    try {
      const size = (await handle.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, 16 * 1024 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      text = buffer.subarray(0, bytesRead).toString('utf8') + (size > buffer.length ? '\n[Crash report truncated at 16 MiB]\n' : '');
    } finally { await handle.close(); }
    await writeFile(file, redactText(text));
    files.push(`crash-reports/${entry.name}`);
  }
  return files;
}
