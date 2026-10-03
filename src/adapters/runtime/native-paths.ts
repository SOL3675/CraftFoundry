import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

interface AliasRecord { version: 2; owner: string; id: string; container: string; alias: string; target: string; cache: string; files: { path: string; sha256: string; size: number }[] }
const recordDir = (cache: string) => join(cache, '.native-aliases');
const contained = (root: string, target: string) => { const rel = relative(root, target); return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const canonical = (path: string) => resolve(path).toLowerCase();
const requireOwner = (owner: string) => { if (!/^[a-f0-9-]{36}$/u.test(owner)) throw new Error('Invalid native alias owner'); };

const nativeProperties = ['java.library.path', 'jna.tmpdir', 'org.lwjgl.system.SharedLibraryExtractPath', 'io.netty.native.workdir', 'org.lwjgl.librarypath'];
/** Only the fresh session's native bytes receive a verified copy at a short physical Windows path. */
export function prepareNativeArguments(args: readonly string[], cache: string, owner: string): string[] {
  if (process.platform !== 'win32') return [...args];
  const indexes = args.flatMap((arg, index) => arg.startsWith('-Djava.library.path=') ? [index] : []);
  if (!indexes.length) return [...args];
  if (indexes.length !== 1) throw new Error('Expected exactly one owned Java native directory');
  requireOwner(owner);
  if (lstatSync(cache).isSymbolicLink()) throw new Error('Owned native cache cannot be redirected');
  const root = realpathSync(cache);
  const original = args[indexes[0]!]!.slice('-Djava.library.path='.length);
  if (!isAbsolute(original)) throw new Error('Native directory must be absolute');
  const target = realpathSync(original);
  if (!contained(root, target) || !lstatSync(target).isDirectory()) throw new Error('Native directory is outside the owned mc-pilot cache');
  for (const arg of args) {
    const property = nativeProperties.find(key => arg.startsWith(`-D${key}=`));
    if (!property) continue;
    const path = arg.slice(`-D${property}=`.length);
    if (!isAbsolute(path) || canonical(realpathSync(path)) !== canonical(target)) throw new Error('Java native properties must identify the same owned directory');
  }
  const container = mkdtempSync(join(realpathSync(tmpdir()), 'mch-n-'));
  const alias = join(container, 'n');
  const id = randomUUID();
  const record: AliasRecord = { version: 2, owner, id, container, alias, target, cache: root, files: [] };
  const nativeArgs = args.map(arg => {
    const property = nativeProperties.find(key => arg.startsWith(`-D${key}=`));
    if (!property) return arg;
    return `-D${property}=${alias}`;
  });
  try {
    if (alias.length > 180) throw new Error('Temporary native alias path is too long');
    writeFileSync(join(container, 'owner.json'), JSON.stringify({ owner, id }), { flag: 'wx' });
    mkdirSync(recordDir(root), { recursive: true });
    // Write ownership before copying, so abrupt launcher disposal is recoverable.
    writeFileSync(join(recordDir(root), `${id}.json`), JSON.stringify(record), { flag: 'wx' });
    mkdirSync(alias);
    let bytes = 0;
    const copyTree = (source: string, destination: string, depth = 0) => {
      if (depth > 32) throw new Error('Native copy exceeds its bounded directory depth');
      for (const entry of readdirSync(source)) {
        const file = join(source, entry); const output = join(destination, entry); const info = lstatSync(file);
        if (info.isSymbolicLink() || !contained(target, realpathSync(file))) throw new Error('Extracted native paths cannot escape their owned directory');
        if (info.isDirectory()) { mkdirSync(output); copyTree(file, output, depth + 1); }
        else if (info.isFile()) {
          bytes += info.size;
          if (record.files.length >= 2048 || info.size > 128 * 1024 * 1024 || bytes > 512 * 1024 * 1024) throw new Error('Native copy exceeds its bounded size limit');
          const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
          copyFileSync(file, output, constants.COPYFILE_EXCL);
          if (createHash('sha256').update(readFileSync(output)).digest('hex') !== sha256) throw new Error('Native copy SHA-256 mismatch');
          record.files.push({ path: relative(alias, output), sha256, size: info.size });
        } else throw new Error('Extracted native entry must be a regular file or directory');
      }
    };
    copyTree(target, alias);
    writeFileSync(join(recordDir(root), `${id}.json`), JSON.stringify(record));
  } catch (error) {
    // Parent cleanup owns the recorded container, including an incomplete copy.
    if (!existsSync(join(recordDir(root), `${id}.json`))) { if (existsSync(join(container, 'owner.json'))) unlinkSync(join(container, 'owner.json')); rmdirSync(container); }
    throw error;
  }
  return nativeArgs;
}

/** Called only after the owning process tree has stopped. Reject links before removing owned physical copies. */
export function cleanupNativeAliases(cache: string, owner: string): void {
  if (process.platform !== 'win32' || !existsSync(cache)) return;
  requireOwner(owner);
  const root = realpathSync(cache);
  if (!existsSync(recordDir(root))) return;
  if (canonical(realpathSync(recordDir(root))) !== canonical(recordDir(root))) throw new Error('Native ownership records cannot be redirected');
  for (const file of readdirSync(recordDir(root))) {
    if (!/^[a-f0-9-]{36}\.json$/u.test(file)) throw new Error('Invalid native ownership record');
    if (!lstatSync(join(recordDir(root), file)).isFile() || lstatSync(join(recordDir(root), file)).isSymbolicLink()) throw new Error('Native ownership record cannot be redirected');
    const record = JSON.parse(readFileSync(join(recordDir(root), file), 'utf8')) as AliasRecord;
    if (record.owner !== owner || record.version !== 2 || `${record.id}.json` !== file || canonical(record.cache) !== canonical(root)
      || canonical(dirname(record.container)) !== canonical(realpathSync(tmpdir())) || !/^mch-n-[a-zA-Z0-9]{6}$/u.test(basename(record.container))
      || record.alias !== join(record.container, 'n') || !contained(root, record.target)) throw new Error('Native alias ownership mismatch');
    if (!existsSync(record.container)) continue; // A previous successful cleanup retains its evidence record.
    if (lstatSync(record.container).isSymbolicLink() || !lstatSync(record.container).isDirectory()) throw new Error('Native alias container changed');
    if (readdirSync(record.container).some(entry => entry !== 'owner.json' && entry !== 'n')) throw new Error('Native alias container contains unowned entries');
    const marker = JSON.parse(readFileSync(join(record.container, 'owner.json'), 'utf8')) as { owner: string; id: string };
    if (marker.owner !== owner || marker.id !== record.id) throw new Error('Native alias marker changed');
    let linkExists = true;
    try { lstatSync(record.alias); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') linkExists = false; else throw error; }
    if (linkExists) {
      if (lstatSync(record.alias).isSymbolicLink() || !lstatSync(record.alias).isDirectory() || canonical(realpathSync(record.alias)) !== canonical(record.alias)) throw new Error('Native alias target changed');
      const files: string[] = []; const directories: string[] = [];
      const inspect = (directory: string, depth = 0) => {
        if (depth > 32) throw new Error('Native cleanup exceeds the bounded directory depth');
        directories.push(directory);
        for (const entry of readdirSync(directory)) {
          const child = join(directory, entry); const info = lstatSync(child);
          if (info.isSymbolicLink() || !contained(record.alias, realpathSync(child))) throw new Error('Native cleanup refuses redirected entries');
          if (info.isDirectory()) inspect(child, depth + 1);
          else if (info.isFile()) files.push(child);
          else throw new Error('Native cleanup refuses non-regular entries');
          if (files.length + directories.length > 4096) throw new Error('Native cleanup exceeds the bounded entry limit');
        }
      };
      inspect(record.alias);
      for (const file of files) unlinkSync(file);
      for (const directory of directories.reverse()) rmdirSync(directory);
    }
    unlinkSync(join(record.container, 'owner.json'));
    rmdirSync(record.container);
  }
}
