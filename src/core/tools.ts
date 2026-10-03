import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../platform/process.js';

export interface McPilotInstallation {
  backendRoot: string; packageTarball: string; helperJar: string; version: string;
  sha256: string; helperSha256: string; lockfile: string;
}
export interface McPilotInstallOptions { npmCommand?: string; signal?: AbortSignal }
const pins = {
  version: '0.15.0',
  url: 'https://registry.npmjs.org/@kzheart_/mc-pilot/-/mc-pilot-0.15.0.tgz',
  sha256: '369ea25fb7a563c97e8b9c1daed01411193579b78a838f5e774900cef8775629',
  helperUrl: 'https://github.com/kzheart/mc-pilot/releases/download/v0.14.0/mct-client-mod-fabric-1.21.1.jar',
  helperSha256: '1242ef239b837222fd4eee6f7d957e0e749bde9d47875d62eba14365df5cb749',
};
/** Internal seams for offline installation contracts. Production callers use the pinned defaults. */
export interface McPilotInstallDependencies {
  fetch?: typeof fetch; runProcess?: typeof runProcess; templateRoot?: string;
  pins?: typeof pins;
}
interface InstallationMetadata {
  schemaVersion: 1; version: string; sha256: string; helperSha256: string;
  packageJsonSha256: string; lockSha256: string; files: Record<string, string>;
}
export interface McPilotInstallationIdentity {
  name: '@kzheart_/mc-pilot'; version: string; sha256: string;
  treeSha256: string; metadataSha256: string; lockSha256: string; files: number;
}
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const matchingHashes = (actual: Record<string, string>, expected: Record<string, string>) => Object.keys(actual).length === Object.keys(expected).length && Object.entries(actual).every(([name, hash]) => expected[name] === hash);
const treeDigest = (files: Record<string, string>) => digest(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
async function info(file: string) {
  try { return await lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
function relativeName(name: string) {
  if (!name || name.includes('\\') || path.isAbsolute(name) || /^[A-Za-z]:/.test(name)
    || name.split('/').some(part => !part || part === '.' || part === '..' || /[\0\r\n]/.test(part))) {
    throw new Error(`Invalid managed tool path: ${name}`);
  }
}
async function securePath(root: string, relative: string, directory = false): Promise<string> {
  relativeName(relative);
  let current = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let existing = await info(current);
    const isDirectory = index < parts.length - 1 || directory;
    if (!existing && isDirectory) { await mkdir(current); existing = await lstat(current); }
    if (existing?.isSymbolicLink()) throw new Error(`Managed tool path contains a symbolic link: ${relative}`);
    if (existing && (isDirectory ? !existing.isDirectory() : !existing.isFile())) throw new Error(`Unexpected managed tool path type: ${relative}`);
  }
  return current;
}
async function fileHash(file: string): Promise<string> { return digest(await readFile(file)); }

async function download(root: string, url: string, sha256: string, extension: string, signal: AbortSignal | undefined, fetcher: typeof fetch): Promise<string> {
  const cache = await securePath(root, '.harness/cache/mc-pilot-downloads', true);
  const output = await securePath(root, `.harness/cache/mc-pilot-downloads/${sha256}${extension}`);
  if (await info(output)) {
    if (await fileHash(output) !== sha256) throw new Error('Cached mc-pilot download hash mismatch');
    return output;
  }
  const lockFile = await securePath(root, `.harness/cache/mc-pilot-downloads/${sha256}${extension}.lock`);
  const lock = await open(lockFile, 'wx').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('mc-pilot download is locked; verify the existing owner before retrying');
    throw error;
  });
  const temporary = path.join(cache, `${sha256}.${randomUUID()}.tmp`);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, url, startedAt: new Date().toISOString() }));
    const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`mc-pilot download HTTP ${response.status}`);
    const handle = await open(temporary, 'wx');
    const hash = createHash('sha256'); let size = 0;
    try {
      for await (const chunk of response.body) {
        signal?.throwIfAborted();
        size += chunk.byteLength;
        if (size > 512 * 1024 * 1024) throw new Error('mc-pilot download exceeds 512 MiB');
        hash.update(chunk); await handle.writeFile(chunk);
      }
    } finally { await handle.close(); }
    if (hash.digest('hex') !== sha256) throw new Error('Downloaded mc-pilot hash mismatch');
    await securePath(root, `.harness/cache/mc-pilot-downloads/${sha256}${extension}`);
    await rename(temporary, output);
    return output;
  } finally {
    await lock.close();
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    await unlink(lockFile);
  }
}

async function npmExecutable(command?: string): Promise<string> {
  const searchDirectories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const candidates = command
    ? (path.isAbsolute(command) || command.includes('/') || command.includes('\\') ? [path.resolve(command)] : searchDirectories.map(dir => path.join(dir, command)))
    : searchDirectories.flatMap(dir => (process.platform === 'win32' ? ['npm.cmd', 'npm.exe', 'npm.bat'] : ['npm']).map(name => path.join(dir, name)));
  for (const candidate of candidates) {
    if (await info(candidate)) {
      const resolved = await realpath(candidate);
      if ((await info(resolved))?.isFile()) return resolved;
    }
  }
  throw new Error('npm was not found on PATH; provide npmCommand pointing to npm.cmd or npm');
}

async function installedHashes(root: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const collect = async (directory: string, relative: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      // npm's launcher links and internal lock are not backend executable sources.
      if (entry.name === '.bin' || (!relative && entry.name === '.package-lock.json')) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      relativeName(name);
      if (entry.isSymbolicLink()) throw new Error(`Installed npm package contains a symbolic link: ${name}`);
      if (entry.isDirectory()) await collect(path.join(directory, entry.name), name);
      else if (entry.isFile()) hashes[name] = await fileHash(path.join(directory, entry.name));
      else throw new Error(`Installed npm package contains a non-regular file: ${name}`);
    }
  };
  await collect(root, '');
  return hashes;
}

/** Verify the executable installation without creating paths, downloading or repairing files. */
export async function validateMcPilotInstallation(backendRoot: string, lockPin: { version: string; sha256: string; url?: string }, dependencies: Pick<McPilotInstallDependencies, 'templateRoot' | 'pins'> = {}): Promise<McPilotInstallationIdentity> {
  const selected = dependencies.pins ?? pins;
  if (lockPin.version !== selected.version || lockPin.sha256 !== selected.sha256 || (lockPin.url !== undefined && lockPin.url !== selected.url)) throw new Error('mc-pilot backend lock does not match the supported pinned installation');
  if (!path.isAbsolute(backendRoot)) throw new Error('mc-pilot backend must be an absolute managed installation path');
  const container = path.dirname(path.dirname(path.dirname(backendRoot)));
  const expectedBackend = path.join(container, 'node_modules', '@kzheart_', 'mc-pilot');
  if (path.relative(expectedBackend, path.resolve(backendRoot))) throw new Error('mc-pilot backend path is not a managed package directory');
  const actualContainer = await realpath(container);
  const regular = async (relative: string, directory = false): Promise<string> => {
    relativeName(relative); let file = actualContainer;
    for (const [index, part] of relative.split('/').entries()) {
      file = path.join(file, part);
      const entry = await lstat(file);
      const isDirectory = directory || index < relative.split('/').length - 1;
      if (entry.isSymbolicLink() || (isDirectory ? !entry.isDirectory() : !entry.isFile())) throw new Error(`mc-pilot managed installation has an unsafe path: ${relative}`);
    }
    return file;
  };
  // The final root may not be a redirected managed directory either.
  if ((await lstat(container)).isSymbolicLink()) throw new Error('mc-pilot managed installation root is redirected');
  const metadataFile = await regular('.mch-mc-pilot.json').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('mc-pilot backend has no managed installation metadata; run mch tools install mc-pilot'); throw error; });
  const metadataBytes = await readFile(metadataFile);
  const metadata = JSON.parse(metadataBytes.toString('utf8')) as InstallationMetadata;
  const templateRoot = dependencies.templateRoot ?? fileURLToPath(new URL('../../templates/mc-pilot/', import.meta.url));
  const packageJson = await readFile(path.join(templateRoot, 'package.json'));
  const lockBytes = await readFile(path.join(templateRoot, 'package-lock.json'));
  const expected = { version: selected.version, sha256: selected.sha256, helperSha256: selected.helperSha256, packageJsonSha256: digest(packageJson), lockSha256: digest(lockBytes) };
  if (metadata.schemaVersion !== 1 || Object.entries(expected).some(([key, value]) => metadata[key as keyof typeof expected] !== value) || !metadata.files || typeof metadata.files !== 'object' || Array.isArray(metadata.files)) throw new Error('mc-pilot managed installation metadata differs from pinned installer inputs');
  if (await fileHash(await regular('package.json')) !== expected.packageJsonSha256 || await fileHash(await regular('package-lock.json')) !== expected.lockSha256 || await fileHash(await regular('mct-client-mod-fabric-1.21.1.jar')) !== selected.helperSha256) throw new Error('mc-pilot installed files differ from pinned inputs');
  const backend = JSON.parse(await readFile(await regular('node_modules/@kzheart_/mc-pilot/package.json'), 'utf8')) as { name?: string; version?: string };
  if (backend.name !== '@kzheart_/mc-pilot' || backend.version !== selected.version) throw new Error('mc-pilot installed package identity/version mismatch');
  const actual = await installedHashes(await regular('node_modules', true));
  if (!matchingHashes(actual, metadata.files)) throw new Error('mc-pilot installed executable tree differs from managed hashes');
  for (const critical of ['@kzheart_/mc-pilot/dist/instance/ClientInstanceManager.js', '@kzheart_/mc-pilot/dist/util/process.js', '@kzheart_/mc-pilot/dist/client/WebSocketClient.js']) if (!actual[critical]) throw new Error(`mc-pilot installation is missing ${critical}`);
  return { name: '@kzheart_/mc-pilot', version: selected.version, sha256: selected.sha256, treeSha256: treeDigest(actual), metadataSha256: digest(metadataBytes), lockSha256: expected.lockSha256, files: Object.keys(actual).length };
}

export async function installMcPilot(projectRoot: string, options: McPilotInstallOptions = {}, dependencies: McPilotInstallDependencies = {}): Promise<McPilotInstallation> {
  options.signal?.throwIfAborted();
  const projectInfo = await lstat(path.resolve(projectRoot));
  if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink()) throw new Error('Project root must be a regular directory');
  const root = await realpath(projectRoot);
  const selected = dependencies.pins ?? pins;
  const templateRoot = dependencies.templateRoot ?? fileURLToPath(new URL('../../templates/mc-pilot/', import.meta.url));
  const packageJson = await readFile(path.join(templateRoot, 'package.json'));
  const lockBytes = await readFile(path.join(templateRoot, 'package-lock.json'));
  const lockData = JSON.parse(lockBytes.toString()) as { lockfileVersion: number; packages: Record<string, { version?: string; resolved?: string; integrity?: string }> };
  const lockedPackage = lockData.packages?.['node_modules/@kzheart_/mc-pilot'];
  if (lockData.lockfileVersion !== 3 || lockedPackage?.version !== selected.version || lockedPackage.resolved !== selected.url || !lockedPackage.integrity?.startsWith('sha512-')) {
    throw new Error('mc-pilot template lock does not match the pinned package');
  }
  const container = await securePath(root, '.harness/tools/mc-pilot', true);
  const metadataFile = await securePath(root, '.harness/tools/mc-pilot/.mch-mc-pilot.json');
  if (!(await info(metadataFile)) && (await readdir(container)).length) throw new Error('Existing mc-pilot tools directory is unmanaged; refusing to overwrite it');
  const lockFile = await securePath(root, '.harness/tools/mc-pilot/.mch-install.lock');
  const installLock = await open(lockFile, 'wx').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('mc-pilot installation is locked');
    throw error;
  });
  try {
    await installLock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const packageTarball = await download(root, selected.url, selected.sha256, '.tgz', options.signal, dependencies.fetch ?? fetch);
    const cliIntegrity = 'sha512-' + createHash('sha512').update(await readFile(packageTarball)).digest('base64');
    if (cliIntegrity !== lockedPackage.integrity) throw new Error('mc-pilot tarball integrity differs from the npm lockfile');
    const helperDownload = await download(root, selected.helperUrl, selected.helperSha256, '.jar', options.signal, dependencies.fetch ?? fetch);
    const helperJar = await securePath(root, '.harness/tools/mc-pilot/mct-client-mod-fabric-1.21.1.jar');
    const lockfile = await securePath(root, '.harness/tools/mc-pilot/package-lock.json');
    const packageFile = await securePath(root, '.harness/tools/mc-pilot/package.json');
    const modules = path.join(container, 'node_modules');
    const backendRoot = path.join(modules, '@kzheart_', 'mc-pilot');
    const expected = { version: selected.version, sha256: selected.sha256, helperSha256: selected.helperSha256,
      packageJsonSha256: digest(packageJson), lockSha256: digest(lockBytes) };
    if (await info(metadataFile)) {
      const metadata = JSON.parse(await readFile(metadataFile, 'utf8')) as InstallationMetadata;
      if (metadata.schemaVersion !== 1 || Object.entries(expected).some(([key, value]) => metadata[key as keyof typeof expected] !== value)
        || !metadata.files || typeof metadata.files !== 'object' || Array.isArray(metadata.files)) throw new Error('mc-pilot managed installation metadata mismatch');
      if (await fileHash(await securePath(root, '.harness/tools/mc-pilot/package.json')) !== expected.packageJsonSha256
        || await fileHash(await securePath(root, '.harness/tools/mc-pilot/package-lock.json')) !== expected.lockSha256
        || await fileHash(helperJar) !== selected.helperSha256) throw new Error('mc-pilot installed files differ from pinned inputs');
      const actual = await installedHashes(await securePath(root, '.harness/tools/mc-pilot/node_modules', true));
      if (!matchingHashes(actual, metadata.files)) throw new Error('mc-pilot installed package contents changed');
    } else {
      options.signal?.throwIfAborted();
      await writeFile(packageFile, packageJson, { flag: 'wx' });
      await writeFile(lockfile, lockBytes, { flag: 'wx' });
      const npm = await npmExecutable(options.npmCommand);
      const npmCache = await securePath(root, '.harness/cache/npm-mc-pilot', true);
      const npmResult = await (dependencies.runProcess ?? runProcess)({ executable: npm,
        args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', npmCache, '--prefix', container],
        cwd: container, timeoutMs: 600_000, logDir: path.join(container, 'install-logs'), ...(options.signal ? { signal: options.signal } : {}) });
      if (npmResult.status !== 'passed') throw new Error(`mc-pilot npm ci ${npmResult.status}: ${npmResult.error ?? npmResult.stderr}`);
      if (await fileHash(packageFile) !== expected.packageJsonSha256 || await fileHash(lockfile) !== expected.lockSha256) throw new Error('npm changed the pinned installation inputs');
      await securePath(root, '.harness/tools/mc-pilot/node_modules/@kzheart_/mc-pilot/package.json');
      const backend = JSON.parse(await readFile(path.join(backendRoot, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (backend.name !== '@kzheart_/mc-pilot' || backend.version !== selected.version) throw new Error('Installed mc-pilot package identity/version mismatch');
      const files = await installedHashes(modules);
      for (const critical of ['@kzheart_/mc-pilot/dist/instance/ClientInstanceManager.js', '@kzheart_/mc-pilot/dist/util/process.js', '@kzheart_/mc-pilot/dist/client/WebSocketClient.js']) {
        if (!files[critical]) throw new Error(`Installed mc-pilot is missing ${critical}`);
      }
      await copyFile(helperDownload, helperJar, constants.COPYFILE_EXCL);
      if (await fileHash(helperJar) !== selected.helperSha256) throw new Error('Installed mc-pilot helper hash mismatch');
      const metadata: InstallationMetadata = { schemaVersion: 1, ...expected, files };
      const temporary = path.join(container, `.mch-mc-pilot-${randomUUID()}.tmp`);
      try { await writeFile(temporary, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, metadataFile); }
      finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    }
    options.signal?.throwIfAborted();
    return { backendRoot, packageTarball, helperJar, version: selected.version, sha256: selected.sha256, helperSha256: selected.helperSha256, lockfile };
  } finally { await installLock.close(); await unlink(lockFile); }
}
