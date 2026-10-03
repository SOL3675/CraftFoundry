import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillsInstallResult { version: string; installed: string[]; updated: string[]; preserved: string[] }
/** Bundle overrides are useful for testing packaged upgrades without modifying installed skills. */
export interface SkillsInstallOptions { sourceRoot?: string; version?: string }
interface SkillRecord { sha256: string; version: string }
interface SkillManifest { schemaVersion: 1; version: string; files: Record<string, SkillRecord> }
const manifestName = '.mch-skills.json';
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

function relativeFile(value: string): void {
  if (!value || value.includes('\\') || value.includes('\0') || path.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error(`Invalid skill manifest path: ${value}`);
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validateManifest(value: unknown): SkillManifest {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.version !== 'string'
    || !versionPattern.test(value.version) || !object(value.files)
    || Object.keys(value).some(key => !['schemaVersion', 'version', 'files'].includes(key))) {
    throw new Error('Invalid skill installation manifest');
  }
  for (const [name, record] of Object.entries(value.files)) {
    relativeFile(name);
    if (!object(record) || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)
      || typeof record.version !== 'string' || !versionPattern.test(record.version)
      || Object.keys(record).some(key => !['sha256', 'version'].includes(key))) {
      throw new Error(`Invalid skill installation record: ${name}`);
    }
  }
  return value as unknown as SkillManifest;
}
async function info(file: string) {
  try { return await lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Reject links instead of following them while deciding whether files can be replaced. */
async function checkPath(root: string, relative: string, createParents = false): Promise<string> {
  relativeFile(relative);
  const parts = relative.split('/');
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let entry = await info(current);
    if (!entry && index < parts.length - 1 && createParents) { await mkdir(current); entry = await lstat(current); }
    if (entry?.isSymbolicLink()) throw new Error(`Skill destination contains a symbolic link: ${relative}`);
    if (entry && index < parts.length - 1 && !entry.isDirectory()) throw new Error(`Skill destination parent is not a directory: ${relative}`);
    if (entry && index === parts.length - 1 && !entry.isFile()) throw new Error(`Skill destination is not a regular file: ${relative}`);
  }
  return current;
}
async function atomicWrite(root: string, relative: string, content: string | Buffer, expectedHash?: string): Promise<void> {
  const target = await checkPath(root, relative, true);
  const temporary = path.join(path.dirname(target), `.mch-skill-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await checkPath(root, relative);
    const currentHash = (await info(target)) ? hash(await readFile(target)) : undefined;
    if (currentHash !== expectedHash) throw new Error(`Skill destination changed while installing: ${relative}`);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
}
async function bundleFiles(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const collect = async (directory: string, relative: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      relativeFile(name);
      if (entry.isSymbolicLink()) throw new Error(`Skill bundle contains a symbolic link: ${name}`);
      if (entry.isDirectory()) await collect(path.join(directory, entry.name), name);
      else if (entry.isFile()) result.set(name, await readFile(path.join(directory, entry.name)));
      else throw new Error(`Skill bundle contains a non-regular file: ${name}`);
    }
  };
  const entries = await readdir(root, { withFileTypes: true });
  if (!entries.length) throw new Error('Skill bundle is empty');
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(entry.name)) throw new Error(`Invalid bundled skill directory: ${entry.name}`);
    const skill = await info(path.join(root, entry.name, 'SKILL.md'));
    if (!skill?.isFile() || skill.isSymbolicLink()) throw new Error(`Bundled skill is missing a regular SKILL.md: ${entry.name}`);
  }
  await collect(root, '');
  return result;
}

/** Installs bundled skills and updates only files whose recorded contents remain unchanged. */
export async function installSkills(destination: string, options: SkillsInstallOptions = {}): Promise<SkillsInstallResult> {
  if (!destination) throw new Error('A skill destination is required');
  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  const version = options.version ?? (JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version;
  if (!versionPattern.test(version)) throw new Error('Invalid skill bundle version');
  const sources = await bundleFiles(options.sourceRoot ?? path.join(packageRoot, 'skills'));
  const requested = path.resolve(destination);
  const destinationInfo = await info(requested);
  if (destinationInfo?.isSymbolicLink() || (destinationInfo && !destinationInfo.isDirectory())) throw new Error('Skill destination must be a directory without a symbolic link');
  await mkdir(requested, { recursive: true });
  const root = await realpath(requested);
  const manifestFile = await checkPath(root, manifestName);
  const lockFile = await checkPath(root, '.mch-skills.lock');
  const token = randomUUID();
  const lock = await open(lockFile, 'wx').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Skill destination is locked: ${lockFile}`);
    throw error;
  });
  try {
    await lock.writeFile(token);
    await lock.close();
    const initialMetadata = (await info(manifestFile)) ? await readFile(manifestFile, 'utf8') : undefined;
    const previous = initialMetadata !== undefined ? validateManifest(JSON.parse(initialMetadata)) : undefined;
    // Validate every managed path before any writes, including records removed from the bundle.
    for (const name of new Set([...sources.keys(), ...Object.keys(previous?.files ?? {})])) await checkPath(root, name);
    const next: SkillManifest = { schemaVersion: 1, version, files: { ...previous?.files } };
    const result: SkillsInstallResult = { version, installed: [], updated: [], preserved: [] };
    for (const [name, content] of sources) {
      const target = await checkPath(root, name);
      const existing = await info(target);
      const digest = hash(content);
      if (!existing) {
        await atomicWrite(root, name, content);
        next.files[name] = { sha256: digest, version };
        result.installed.push(name);
      } else {
        const currentHash = hash(await readFile(target));
        const recorded = previous?.files[name];
        if (!recorded || recorded.sha256 !== currentHash) { result.preserved.push(name); continue; }
        if (currentHash !== digest) {
          // Recheck content before replacing to detect user edits during this installation.
          if (hash(await readFile(await checkPath(root, name))) !== currentHash) throw new Error(`Skill changed while installing: ${name}`);
          await atomicWrite(root, name, content, currentHash);
          result.updated.push(name);
        }
        next.files[name] = { sha256: digest, version };
      }
    }
    const currentMetadata = (await info(manifestFile)) ? await readFile(await checkPath(root, manifestName), 'utf8') : undefined;
    if (currentMetadata !== initialMetadata) throw new Error('Skill installation manifest changed while installing');
    await atomicWrite(root, manifestName, JSON.stringify(next, null, 2) + '\n', initialMetadata !== undefined ? hash(initialMetadata) : undefined);
    return result;
  } finally {
    await lock.close().catch(() => {});
    const currentToken = await readFile(lockFile, 'utf8');
    if (currentToken !== token) throw new Error('Skill installation lock ownership changed');
    await unlink(lockFile);
  }
}
