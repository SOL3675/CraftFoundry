import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact, LoadedConfig, RuntimeConfig, SuiteConfig, CaseResult } from '../../core/types.js';
import { OwnedServer } from '../runtime/server.js';

/** Assertions must read restored game state. The second launch never runs seed commands. */
export async function runServerPersistence(loaded: LoadedConfig, target: string, runtime: RuntimeConfig, suite: SuiteConfig,
  artifacts: Artifact[], runRoot: string, directory: string, signal?: AbortSignal) {
  if (!suite.persistence) throw new Error('Persistence suite needs seed and restoration assertions');
  const server = new OwnedServer(loaded, target, runtime, directory, path.join(directory, 'process-logs'));
  const cases: CaseResult[] = [], logs: string[] = [], nonce = randomUUID();
  const transcript: unknown[] = [];
  let stage = 'persistence.seed';
  const query = async (probe: { command: string; pattern: string; failurePattern?: string }) => {
    const mark = server.mark(), command = probe.command.replaceAll('{nonce}', nonce), pattern = probe.pattern.replaceAll('{nonce}', nonce);
    server.command(command);
    const launch = cases.some(c => c.id === 'persistence.stopped') ? 2 : 1;
    try {
      const failure = probe.failurePattern?.replaceAll('{nonce}', nonce);
      const output = await server.waitForOutput(new RegExp(pattern), loaded.local.timeouts?.test ?? 120_000, mark, failure ? new RegExp(failure) : undefined);
      transcript.push({ launch, command, output });
    } catch (error) { transcript.push({ launch, command, error: (error as Error).message }); throw error; }
  };
  await mkdir(directory, { recursive: true });
  try {
    await server.prepare(artifacts, runRoot, signal); await server.start(signal); await server.waitReady();
    for (const probe of suite.persistence.seed) await query(probe);
    for (const probe of suite.persistence.assertions) await query(probe);
    cases.push({ id: stage, status: 'passed' });
    stage = 'persistence.saved';
    await query({ command: 'save-all flush', pattern: 'Saved the game' });
    cases.push({ id: stage, status: 'passed' });
    stage = 'persistence.stopped';
    const first = await server.stopClean(); logs.push(first.logs.stdout, first.logs.stderr);
    cases.push({ id: stage, status: 'passed', message: 'First dedicated process exited cleanly before restart' });
    stage = 'persistence.restarted';
    await server.restart(signal); await server.waitReady();
    cases.push({ id: stage, status: 'passed' });
    for (const probe of suite.persistence.assertions) {
      stage = probe.id; await query(probe); cases.push({ id: stage, status: 'passed', message: 'Restored from the same disposable world in the second dedicated process' });
    }
    stage = 'persistence.final-stop';
    const last = await server.stopClean(); logs.push(last.logs.stdout, last.logs.stderr);
    cases.push({ id: stage, status: 'passed' });
  } catch (error) {
    cases.push({ id: stage, status: stage.startsWith('persistence.restore.') ? 'failed' : 'infrastructure-error', message: (error as Error).message });
  } finally {
    const stopped = await server.stop();
    if (stopped) logs.push(stopped.logs.stdout, stopped.logs.stderr);
  }
  const ids = ['persistence.seed', 'persistence.saved', 'persistence.stopped', 'persistence.restarted', ...suite.persistence.assertions.map(a => a.id), 'persistence.final-stop'];
  for (const id of ids) if (!cases.some(c => c.id === id)) cases.push({ id, status: 'skipped', message: 'Persistence prerequisite failed' });
  if (server.ownsDirectory) await writeFile(path.join(directory, 'persistence.json'), JSON.stringify({ schemaVersion: 1, owner: server.owner, nonce, transcript, cases }, null, 2));
  return { cases, logs: [...new Set(logs)].map(file => path.relative(runRoot, file)),
    evidence: (server.ownsDirectory ? ['persistence.json', ...await server.collectEvidence()] : []).map(file => path.relative(runRoot, path.join(directory, file))) };
}
