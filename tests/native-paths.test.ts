import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { cleanupNativeAliases, prepareNativeArguments } from '../dist/adapters/runtime/native-paths.js';

const windows = process.platform === 'win32';
function session(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'mch-native-test-'));
  const cache = join(root, 'mct-cache'); mkdirSync(cache);
  const owner = randomUUID();
  t.after(async () => { await cleanupNativeAliases(cache, owner); rmSync(root, { recursive: true, force: true }); });
  const native = join(cache, ...Array.from({ length: 8 }, (_, i) => `${i}-${'deep'.repeat(8)}`), 'natives');
  mkdirSync(native, { recursive: true }); writeFileSync(join(native, 'glfw.dll'), 'owned native bytes');
  return { root, cache, owner, native };
}

test('non-Windows native arguments retain their exact paths without filesystem access', { skip: windows }, async () => {
  const args = ['-Djava.library.path=/not-created/cache/natives', '-cp', '/original/classpath'];
  assert.deepEqual(prepareNativeArguments(args, '/not-created/cache', 'unused'), args);
  await cleanupNativeAliases('/not-created/cache', 'unused');
});

test('deep Windows native path gets a verified short physical copy; cleanup retains original DLL and evidence', { skip: !windows }, async t => {
  const { cache, owner, native } = session(t);
  assert.ok(native.length > 300);
  const result = prepareNativeArguments(['-Xmx1G', `-Djava.library.path=${native}`, '-cp', 'unchanged.jar', `-Dorg.lwjgl.system.SharedLibraryExtractPath=${native}`], cache, owner);
  const alias = result[1]!.slice('-Djava.library.path='.length);
  assert.ok(alias.length < 180);
  assert.equal(readFileSync(join(alias, 'glfw.dll'), 'utf8'), 'owned native bytes');
  assert.deepEqual([result[0], ...result.slice(2, 4)], ['-Xmx1G', '-cp', 'unchanged.jar']);
  assert.equal(result[4], `-Dorg.lwjgl.system.SharedLibraryExtractPath=${alias}`);
  const record = JSON.parse(readFileSync(join(cache, '.native-aliases', readdirSync(join(cache, '.native-aliases'))[0]!), 'utf8'));
  assert.match(record.files[0].sha256, /^[a-f0-9]{64}$/u);
  await cleanupNativeAliases(cache, owner); await cleanupNativeAliases(cache, owner);
  assert.equal(existsSync(alias), false);
  assert.equal(readFileSync(join(native, 'glfw.dll'), 'utf8'), 'owned native bytes');
  assert.equal(readdirSync(join(cache, '.native-aliases')).length, 1);
});

test('Windows native alias refuses external directory and redirected cache descendants', { skip: !windows }, t => {
  const { root, cache, owner } = session(t);
  const outside = join(root, 'outside'); mkdirSync(outside);
  assert.throws(() => prepareNativeArguments([`-Djava.library.path=${outside}`], cache, owner), /outside the owned/);
  const redirected = join(cache, 'redirected'); symlinkSync(outside, redirected, 'junction');
  assert.throws(() => prepareNativeArguments([`-Djava.library.path=${redirected}`], cache, owner), /outside the owned/);
  assert.equal(existsSync(join(cache, '.native-aliases')), false);
});

test('Windows native properties cannot redirect extraction into another directory', { skip: !windows }, t => {
  const { cache, owner, native } = session(t);
  const other = join(cache, 'other'); mkdirSync(other);
  const fs = createRequire(import.meta.url)('node:fs');
  const original = fs.mkdtempSync; let allocations = 0;
  fs.mkdtempSync = () => { allocations++; throw new Error('Invalid native properties allocated a temporary directory'); };
  syncBuiltinESMExports();
  try { assert.throws(() => prepareNativeArguments([`-Djava.library.path=${native}`, `-Djna.tmpdir=${other}`], cache, owner), /same owned directory/); }
  finally { fs.mkdtempSync = original; syncBuiltinESMExports(); }
  assert.equal(allocations, 0);
  assert.equal(existsSync(join(cache, '.native-aliases')), false);
});

test('Windows native copy refuses source links and cleans only its incomplete copy', { skip: !windows }, async t => {
  const { root, cache, owner, native } = session(t);
  const outside = join(root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'keep.dll'), 'preserved');
  symlinkSync(outside, join(native, 'external'), 'junction');
  assert.throws(() => prepareNativeArguments([`-Djava.library.path=${native}`], cache, owner), /cannot escape/);
  const record = JSON.parse(readFileSync(join(cache, '.native-aliases', readdirSync(join(cache, '.native-aliases'))[0]!), 'utf8'));
  await cleanupNativeAliases(cache, owner);
  assert.equal(existsSync(record.container), false);
  assert.equal(readFileSync(join(outside, 'keep.dll'), 'utf8'), 'preserved');
});

test('Windows native alias rejects duplicate properties and a forged cleanup owner', { skip: !windows }, async t => {
  const { cache, owner, native } = session(t);
  assert.throws(() => prepareNativeArguments([`-Djava.library.path=${native}`, `-Djava.library.path=${native}`], cache, owner), /exactly one/);
  const alias = prepareNativeArguments([`-Djava.library.path=${native}`], cache, owner)[0]!.slice('-Djava.library.path='.length);
  await assert.rejects(cleanupNativeAliases(cache, randomUUID()), /ownership mismatch/);
  assert.equal(existsSync(alias), true);
});

test('Windows cleanup refuses a replaced directory junction and preserves the external target', { skip: !windows }, async t => {
  const { root, cache, owner, native } = session(t);
  const alias = prepareNativeArguments([`-Djava.library.path=${native}`], cache, owner)[0]!.slice('-Djava.library.path='.length);
  const outside = join(root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'keep.txt'), 'preserved');
  rmSync(alias, {recursive:true}); symlinkSync(outside, alias, 'junction');
  try {
    await assert.rejects(cleanupNativeAliases(cache, owner), /target changed/);
    assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'preserved');
    assert.equal(existsSync(alias), true);
  } finally { rmdirSync(alias); mkdirSync(alias); }
});

test('preloaded launcher hook updates the child spawn imported through ESM', { skip: !windows }, async t => {
  const { root, cache, owner, native } = session(t);
  const launcher = join(root, 'launcher.mjs');
  writeFileSync(launcher, `import {spawnSync, spawn} from 'node:child_process';
const child = spawn(process.execPath, ['-e','console.log(process.argv[1])', '--', process.env.TEST_NATIVE_ARG], {stdio:'inherit'});
child.once('exit', code => process.exitCode=code);
`);
  const stdout = execFileSync(process.execPath, ['--import', pathToFileURL(resolve('dist/adapters/runtime/native-launch-hook.js')).href, launcher], { env: { ...process.env, MCT_CACHE_DIR: cache, MCH_NATIVE_OWNER: owner, TEST_NATIVE_ARG: `-Djava.library.path=${native}` }, encoding: 'utf8' });
  const alias = stdout.trim().slice('-Djava.library.path='.length);
  assert.equal(readFileSync(join(alias, 'glfw.dll'), 'utf8'), 'owned native bytes');
  await cleanupNativeAliases(cache, owner);
  assert.equal(existsSync(alias), false);
});

test('Windows cleanup retries transient DLL locks asynchronously and retains original bytes and evidence', { skip: !windows }, async t => {
  const { cache, owner, native } = session(t);
  const alias = prepareNativeArguments([`-Djava.library.path=${native}`], cache, owner)[0]!.slice('-Djava.library.path='.length);
  const dll = join(alias, 'glfw.dll');
  const fs = createRequire(import.meta.url)('node:fs');
  const original = fs.unlinkSync; let attempts = 0; let released = false;
  const release = setTimeout(() => { released = true; }, 120);
  fs.unlinkSync = (file: string) => {
    if (file === dll) {
      attempts++;
      if (!released) throw Object.assign(new Error('DLL still loaded by exiting Java'), { code: attempts % 2 ? 'EBUSY' : 'EPERM', path: file });
    }
    return original(file);
  };
  syncBuiltinESMExports();
  try { await cleanupNativeAliases(cache, owner); }
  finally { clearTimeout(release); fs.unlinkSync = original; syncBuiltinESMExports(); }
  assert.equal(released, true); assert.ok(attempts >= 2);
  assert.equal(existsSync(alias), false);
  assert.equal(readFileSync(join(native, 'glfw.dll'), 'utf8'), 'owned native bytes');
  assert.equal(readdirSync(join(cache, '.native-aliases')).length, 1);
});

test('Windows cleanup bounds a persistent DLL lock and leaves ownership evidence for later cleanup', { skip: !windows }, async t => {
  const { cache, owner, native } = session(t);
  const alias = prepareNativeArguments([`-Djava.library.path=${native}`], cache, owner)[0]!.slice('-Djava.library.path='.length);
  const dll = join(alias, 'glfw.dll');
  const fs = createRequire(import.meta.url)('node:fs');
  const original = fs.unlinkSync; let attempts = 0;
  const failure = Object.assign(new Error('Persistent Java DLL lock'), { code: 'EBUSY', path: dll });
  fs.unlinkSync = (file: string) => { if (file === dll) { attempts++; throw failure; } return original(file); };
  syncBuiltinESMExports();
  const started = performance.now();
  try {
    await assert.rejects(cleanupNativeAliases(cache, owner), (error: any) => {
      assert.equal(error.code, 'EBUSY'); assert.equal(error.path, dll); assert.equal(error.cause, failure);
      assert.match(error.message, /within 5000ms after \d+ attempts/); return true;
    });
  } finally { fs.unlinkSync = original; syncBuiltinESMExports(); }
  assert.ok(performance.now() - started >= 5_000); assert.ok(attempts >= 2 && attempts <= 200);
  assert.equal(readFileSync(dll, 'utf8'), 'owned native bytes');
  assert.equal(existsSync(join(alias, '..', 'owner.json')), true);
  assert.equal(readdirSync(join(cache, '.native-aliases')).length, 1);
  await cleanupNativeAliases(cache, owner);
  assert.equal(existsSync(alias), false);
});

test('Windows cleanup propagates a non-lock deletion error without retries or masking', { skip: !windows }, async t => {
  const { cache, owner, native } = session(t);
  const alias = prepareNativeArguments([`-Djava.library.path=${native}`], cache, owner)[0]!.slice('-Djava.library.path='.length);
  const dll = join(alias, 'glfw.dll');
  const fs = createRequire(import.meta.url)('node:fs');
  const original = fs.unlinkSync; let attempts = 0;
  const failure = Object.assign(new Error('Native disk error'), { code: 'EIO', path: dll });
  fs.unlinkSync = (file: string) => { if (file === dll) { attempts++; throw failure; } return original(file); };
  syncBuiltinESMExports();
  try { await assert.rejects(cleanupNativeAliases(cache, owner), error => error === failure); }
  finally { fs.unlinkSync = original; syncBuiltinESMExports(); }
  assert.equal(attempts, 1); assert.equal(existsSync(dll), true);
});

test('Windows cleanup revalidates a junction replacement while awaiting DLL release', { skip: !windows }, async t => {
  const { root, cache, owner, native } = session(t);
  const alias = prepareNativeArguments([`-Djava.library.path=${native}`], cache, owner)[0]!.slice('-Djava.library.path='.length);
  const outside = join(root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'glfw.dll'), 'external bytes');
  const fs = createRequire(import.meta.url)('node:fs');
  const original = fs.unlinkSync; let attempts = 0;
  fs.unlinkSync = (file: string) => { if (file === join(alias, 'glfw.dll')) { attempts++; throw Object.assign(new Error('Locked before replacement'), { code: 'EBUSY', path: file }); } return original(file); };
  syncBuiltinESMExports();
  const replace = setTimeout(() => { original(join(alias, 'glfw.dll')); rmdirSync(alias); symlinkSync(outside, alias, 'junction'); }, 10);
  try {
    await assert.rejects(cleanupNativeAliases(cache, owner), /target changed/);
    assert.equal(attempts, 1); assert.equal(readFileSync(join(outside, 'glfw.dll'), 'utf8'), 'external bytes');
  } finally {
    clearTimeout(replace); fs.unlinkSync = original; syncBuiltinESMExports();
    rmdirSync(alias); mkdirSync(alias);
  }
});
