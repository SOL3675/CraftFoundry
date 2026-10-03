import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from '../dist/platform/process.js';

async function workingDir(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mch 空白 日本語 '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('process captures UTF-8 stdout/stderr in a space and Japanese working path', async t => {
  const dir = await workingDir(t);
  const args = ['hello world', '日本語', 'quote"here', 'a&b', '%PATH%', '', 'trailing\\'];
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)));console.error("日本語 error");', ...args], cwd: dir, timeoutMs: 10_000, logDir: join(dir, 'logs') });
  assert.equal(result.status, 'passed', result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
  assert.equal(result.stderr.trim(), '日本語 error');
  assert.equal(await readFile(result.logs.stdout, 'utf8'), result.stdout);
  assert.equal(await readFile(result.logs.stderr, 'utf8'), result.stderr);
});

test('exit failure and absent executable have distinct statuses', async t => {
  const dir = await workingDir(t);
  const failed = await runProcess({ executable: process.execPath, args: ['-e', 'process.exit(17)'], cwd: dir, timeoutMs: 10_000, logDir: join(dir, 'failed') });
  assert.equal(failed.status, 'failed'); assert.equal(failed.exitCode, 17);
  const missing = await runProcess({ executable: join(dir, 'absent-executable'), args: [], cwd: dir, timeoutMs: 10_000, logDir: join(dir, 'missing') });
  assert.equal(missing.status, 'infrastructure-error', missing.stderr);
});

test('pre-cancelled invocation starts no process and persists empty logs', async t => {
  const dir = await workingDir(t); const controller = new AbortController(); controller.abort();
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'throw Error("started")'], cwd: dir, signal: controller.signal, timeoutMs: 10_000, logDir: join(dir, 'logs') });
  assert.equal(result.status, 'cancelled'); assert.equal(result.exitCode, null); assert.equal(result.stderr, '');
});

test('timeout requests graceful input before forced shutdown', async t => {
  const dir = await workingDir(t);
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'process.stdin.on("data",x=>{if(x.toString().trim()==="stop"){console.log("stopped");process.exit(0)}});'], cwd: dir, timeoutMs: 2_000, stopTimeoutMs: 2_000, gracefulInput: 'stop\n', logDir: join(dir, 'logs') });
  assert.equal(result.status, 'timed-out'); assert.equal(result.exitCode, 0, result.stderr); assert.match(result.stdout, /stopped/u);
});

async function waitForFile(path: string): Promise<string> {
  const end = Date.now() + 12_000;
  while (Date.now() < end) {
    try { const content = await readFile(path, 'utf8'); if (content) return content; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Child did not become ready: ${path}`);
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('cancel stops an owned descendant even when parent exits on graceful input', async t => {
  const dir = await workingDir(t); const pidFile = join(dir, 'child.pid');
  const childScript = join(dir, 'child.mjs');
  await writeFile(childScript, 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);');
  const parentScript = join(dir, 'parent.mjs');
  await writeFile(parentScript, 'import {spawn} from "node:child_process";import {writeFileSync} from "node:fs";const c=spawn(process.execPath,[process.argv[2]],{stdio:"inherit"});writeFileSync(process.argv[3],String(c.pid));process.stdin.on("data",()=>process.exit(0));setInterval(()=>{},1000);');
  const controller = new AbortController();
  const pending = runProcess({ executable: process.execPath, args: [parentScript, childScript, pidFile], cwd: dir, timeoutMs: 20_000, stopTimeoutMs: 500, gracefulInput: 'stop\n', signal: controller.signal, logDir: join(dir, 'logs') });
  const pid = Number(await waitForFile(pidFile)); assert.equal(isAlive(pid), true);
  controller.abort(); const result = await pending;
  assert.equal(result.status, 'cancelled'); assert.equal(isAlive(pid), false, 'owned descendant survived graceful parent exit');
});

test('forced shutdown is bounded for a parent and descendant that hang', async t => {
  const dir = await workingDir(t); const pidFile = join(dir, 'child.pid');
  const parentScript = join(dir, 'hang.mjs');
  await writeFile(parentScript, 'import {spawn} from "node:child_process";import {writeFileSync} from "node:fs";const c=spawn(process.execPath,["-e","process.on(\\"SIGTERM\\",()=>{});setInterval(()=>{},1000)"],{stdio:"inherit"});writeFileSync(process.argv[2],String(c.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000);');
  const controller = new AbortController();
  const pending = runProcess({ executable: process.execPath, args: [parentScript, pidFile], cwd: dir, timeoutMs: 20_000, stopTimeoutMs: 100, signal: controller.signal, logDir: join(dir, 'logs') });
  const pid = Number(await waitForFile(pidFile));
  const start = Date.now(); controller.abort(); const result = await pending;
  assert.equal(result.status, 'cancelled'); assert.ok(Date.now() - start < 6_000); assert.equal(isAlive(pid), false);
});

test('a completed parent leaves no owned descendants', async t => {
  const dir = await workingDir(t); const pidFile = join(dir, 'child.pid');
  const script = join(dir, 'exit.mjs');
  await writeFile(script, 'import {spawn} from "node:child_process";import {writeFileSync} from "node:fs";const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});writeFileSync(process.argv[2],String(c.pid));process.exit(0);');
  const result = await runProcess({ executable: process.execPath, args: [script, pidFile], cwd: dir, timeoutMs: 10_000, logDir: join(dir, 'logs') });
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.equal(result.status, 'passed'); assert.equal(isAlive(pid), false);
});

test('redaction applies to returned output and persisted logs', async t => {
  const dir = await workingDir(t);
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'console.log("secret-token");console.error("secret-token")'], cwd: dir, timeoutMs: 10_000, logDir: join(dir, 'logs'), redact: text => text.replaceAll('secret-token', '[REDACTED]') });
  assert.equal(result.status, 'passed'); assert.equal(result.stdout.trim(), '[REDACTED]');
  assert.ok(!(await readFile(result.logs.stdout, 'utf8')).includes('secret-token'));
  assert.ok(!(await readFile(result.logs.stderr, 'utf8')).includes('secret-token'));
});

test('live readiness callback receives raw output and writes only to the live process', async t => {
  const dir = await workingDir(t); let control: { write(input: string): void } | undefined; let seen = '';
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'console.log("READY secret-token");process.stdin.on("data",()=>process.exit(0))'], cwd: dir, timeoutMs: 10_000, logDir: join(dir, 'logs'), onStart: value => { control = value; }, onOutput: (stream, text) => { if (stream === 'stdout') { seen += text; if (seen.includes('READY')) control!.write('stop\n'); } }, redact: text => text.replaceAll('secret-token', '[REDACTED]') });
  assert.equal(result.status, 'passed'); assert.match(seen, /secret-token/u); assert.match(result.stdout, /REDACTED/u);
  assert.throws(() => control!.write('after exit\n'), /closed/u);
});

test('a throwing readiness callback becomes infrastructure failure and stops its process', async t => {
  const dir = await workingDir(t);
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'console.log("READY");setInterval(()=>{},1000)'], cwd: dir, timeoutMs: 10_000, stopTimeoutMs: 0, logDir: join(dir, 'logs'), onOutput: () => { throw new Error('readiness failed'); } });
  assert.equal(result.status, 'infrastructure-error'); assert.match(result.error ?? '', /readiness failed/u);
});

test('a noisy process is stopped at the output limit and cannot exhaust retained logs', async t => {
  const dir = await workingDir(t);
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'setInterval(()=>console.log("x".repeat(4096)),1)'], cwd: dir, timeoutMs: 10_000, stopTimeoutMs: 0, maxOutputBytes: 8192, logDir: join(dir, 'logs') });
  assert.equal(result.status, 'infrastructure-error'); assert.match(result.error ?? '', /output exceeds/u);
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 8192);
});

test('real Windows batch preserves spaces, Japanese arguments, empty arguments', { skip: process.platform !== 'win32' }, async t => {
  const dir = await workingDir(t); const script = join(dir, 'arguments.mjs'); const batch = join(dir, 'wrapper 日本語.bat');
  await writeFile(script, 'console.log(JSON.stringify(process.argv.slice(2)));');
  // Avoid cmd.exe codepage dependence for paths inside the file.
  await writeFile(batch, `@echo off\r\n"${process.execPath}" arguments.mjs %*\r\n`);
  const args = ['hello world', '日本語', '', '-Pvalue=some words', 'C:\\space path\\'];
  const result = await runProcess({ executable: batch, args, cwd: dir, timeoutMs: 10_000, logDir: join(dir, 'logs') });
  assert.equal(result.status, 'passed', result.stderr); assert.deepEqual(JSON.parse(result.stdout), args);
});
