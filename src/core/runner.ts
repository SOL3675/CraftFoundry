import { mkdir, open, realpath, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LoadedConfig, ProcessResult } from './types.js';
import { GradleBuildAdapter } from '../adapters/build/gradle.js';
import { evaluateSuite, parseResults } from '../adapters/test/results.js';
import { runProcess } from '../platform/process.js';
import { OwnedServer } from '../adapters/runtime/server.js';
import { redact, redactText } from '../reporting/redact.js';
import { resolveTool } from './cache.js';
import { validateMcPilotInstallation } from './tools.js';
import { runClientSmoke, runFixtureMultiplayer, runFixtureMultiClient, fixtureCapabilities } from '../adapters/test/multiplayer.js';
import { runServerPersistence } from '../adapters/test/persistence.js';
import { attachStorageEvidence, createRun, saveReport } from '../reporting/report.js';
import { clientDisplayEnvironment } from '../platform/display.js';
import type { CaseStatus, RunReport, SuiteReport, TargetReport } from '../reporting/types.js';
import { retainResultDetails } from '../reporting/result-details.js';
import { finalizeStorageUnit, cleanupStorage, releaseStorageLease, closeStorageReservation, createStorageEvidenceSeal, type StorageUnitHandle, type StorageLeaseHandle } from './storage.js';
import { assertContainedPath } from './paths.js';
import { retainClientDependencyMetadata } from '../reporting/dependency-metadata.js';

export interface RunOptions { command: 'build' | 'inspect' | 'test'; targets: string[]; suites?: string[]; profile?: 'release'; signal?: AbortSignal }
interface CompletedStorageLease { reservation: StorageUnitHandle; lease: StorageLeaseHandle; cacheDir?: string }
function processStatus(process: ProcessResult): CaseStatus {
  return process.status === 'passed' ? 'passed' : process.status === 'failed' ? 'failed' : 'infrastructure-error';
}
function relative(root: string, file: string): string { return path.relative(root, file).replaceAll('\\', '/'); }
function aggregate(statuses: CaseStatus[]): CaseStatus {
  if (statuses.includes('infrastructure-error')) return 'infrastructure-error';
  return statuses.length && statuses.every(status => status === 'passed') ? 'passed' : 'failed';
}
async function containedResults(root: string, relativePath: string): Promise<string> {
  const file = path.resolve(root, relativePath);
  // Check parent before deleting stale results. Symlink targets cannot escape the build root.
  let parent = path.dirname(file);
  while (true) {
    try {
      const resolved = await realpath(parent);
      const rel = path.relative(await realpath(root), resolved);
      if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) throw new Error('Test result directory escapes its root');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = path.dirname(parent); if (next === parent) throw error; parent = next;
    }
  }
  return file;
}

export async function executeRun(loaded: LoadedConfig, options: RunOptions): Promise<RunReport> {
  const unique = (ids: string[], kind: string) => {
    const paths = ids.map(id => process.platform === 'win32' ? id.toLowerCase() : id);
    if (new Set(paths).size !== paths.length) throw new Error(`Duplicate or colliding ${kind} selections would reuse retained evidence paths`);
  };
  unique(options.targets, 'target');
  if (options.suites) unique(options.suites, 'suite');
  if (options.command === 'test') for (const id of options.targets) {
    const suites = options.profile === 'release' || !options.suites?.length ? loaded.config.targets[id]?.requiredSuites : options.suites;
    if (suites) unique(suites, 'suite');
  }
  const suffix = options.profile ? ' --profile release' : options.suites?.map(id => ` --suite ${id}`).join('') ?? '';
  const command = `mch ${options.command} ${options.targets.length === 1 ? `--target ${options.targets[0]}` : '--all'}${suffix}`;
  const { report, directory } = await createRun(loaded, command);
  const adapter = new GradleBuildAdapter(loaded);
  const stoppedStorageUnits: StorageUnitHandle[] = [];
  try {
    for (const id of options.targets) {
      const target = loaded.config.targets[id];
      if (!target) throw new Error(`Unknown target: ${id}`);
      const result: TargetReport = { id, minecraft: target.minecraft, loader: target.loader, status: 'infrastructure-error', artifacts: [], suites: [] };
      report.targets.push(result);
      const logDir = path.join(directory, 'logs', id);
      if (options.signal?.aborted) { result.error = 'Run cancelled before target execution'; continue; }
      const build = options.command === 'inspect' ? await adapter.inspect(id, { logDir, signal: options.signal })
        : await adapter.build(id, { logDir, signal: options.signal });
      if (build.status !== 'passed') {
        result.status = build.status === 'failed' ? 'failed' : 'infrastructure-error';
        result.error = build.error ?? `Build ${build.status}`; continue;
      }
      result.resolved = build.manifest;
      const artifactDir = path.join(directory, 'artifacts', id);
      result.artifacts = (await adapter.collectArtifacts(id, artifactDir)).map(artifact => ({ ...artifact, path: relative(directory, path.join(artifactDir, artifact.path)) }));
      result.status = 'passed';
      if (options.command === 'test') {
        const suiteIds = options.profile === 'release' || !options.suites?.length ? target.requiredSuites : options.suites;
        if (!suiteIds.length) { result.status = 'failed'; result.error = 'No suites selected or required; no release validation performed'; }
        for (const suiteId of suiteIds) {
          const completedLeases: CompletedStorageLease[] = [];
          const suite = await executeSuite(loaded, adapter, id, suiteId, directory, result.artifacts, options.signal, unit => stoppedStorageUnits.push(unit), (reservation, lease, cacheDir) => completedLeases.push({ reservation, lease, cacheDir }));
          result.suites.push(suite);
          await saveReport(directory, report);
          if (completedLeases.length) await completeSuiteStorage(loaded, directory, report, result, suite, completedLeases);
        }
        if (suiteIds.length) result.status = aggregate(result.suites.map(suite => suite.status));
      }
      await saveReport(directory, report);
    }
    report.status = aggregate(report.targets.map(target => target.status));
  } catch (error) {
    report.status = 'infrastructure-error'; report.error = (error as Error).message;
  } finally {
    report.finishedAt = new Date().toISOString();
    await saveReport(directory, report);
    for (const unit of stoppedStorageUnits) await finalizeStorageUnit(loaded.root, unit, { stopped: true, evidenceRoot: directory });
    if (loaded.local.storage?.cleanup === 'after-run' && stoppedStorageUnits.length) {
      const cleanup = await cleanupStorage(loaded.root, { apply: true, unitIds: stoppedStorageUnits.map(unit => unit.id) });
      if (cleanup.errors.length) throw new Error(`Storage cleanup incomplete; inspect ${cleanup.auditPath}: ${cleanup.errors.join('; ')}`);
    }
  }
  return report;
}

/** @internal Complete a closed built-in suite without waiting for the rest of its Run. */
export async function completeSuiteStorage(loaded: LoadedConfig, directory: string, report: RunReport, target: TargetReport, suite: SuiteReport, completed: CompletedStorageLease[]): Promise<void> {
  const snapshot = path.join(directory, 'storage-evidence', `${randomUUID()}.json`);
  await assertContainedPath(directory, snapshot);
  await mkdir(path.dirname(snapshot), { recursive: true });
  const metadata = await open(snapshot, 'wx');
  try {
    await metadata.writeFile(`${JSON.stringify(redact({ schemaVersion: 1, run: { id: report.id, harnessVersion: report.harnessVersion, platform: report.platform, command: report.command, startedAt: report.startedAt, reproduction: report.reproduction }, target: { id: target.id, minecraft: target.minecraft, loader: target.loader, resolved: target.resolved }, suite, source: report.source, configuration: report.configuration, lock: report.lock, artifacts: target.artifacts }), null, 2)}\n`);
    await metadata.sync();
  } finally { await metadata.close(); }
  const dependencyMetadata = [];
  for (const item of completed) if (item.cacheDir) dependencyMetadata.push(...await retainClientDependencyMetadata(loaded.root, item.cacheDir, directory));
  const files = [...new Set([relative(directory, snapshot), ...dependencyMetadata, ...(suite.logs ?? []), ...(suite.evidence ?? []), ...target.artifacts.map(artifact => artifact.path), ...(report.source.diffPath ? [report.source.diffPath] : []), ...(report.source.untrackedManifest ? [report.source.untrackedManifest] : [])])];
  const seal = await createStorageEvidenceSeal(loaded.root, directory, { scope: { target: target.id, suite: suite.id }, files });
  await attachStorageEvidence(loaded.root, directory, [seal]);
  for (const { lease } of completed) await releaseStorageLease(loaded.root, lease, { stopped: true, evidenceRoot: directory, seal });
  await saveReport(directory, report);
  for (const { reservation } of completed) await closeStorageReservation(loaded.root, reservation);
  const cleanup = await cleanupStorage(loaded.root, { apply: true, unitIds: completed.map(item => item.reservation.id) });
  if (cleanup.errors.length) throw new Error(`Storage cleanup incomplete; inspect ${cleanup.auditPath}: ${cleanup.errors.join('; ')}`);
}

async function executeSuite(loaded: LoadedConfig, adapter: GradleBuildAdapter, targetId: string, suiteId: string, directory: string, artifacts: TargetReport['artifacts'], signal?: AbortSignal, onStorageUnitStopped?: (unit: StorageUnitHandle) => void, onStorageLeaseStopped?: (reservation: StorageUnitHandle, lease: StorageLeaseHandle, cacheDir: string) => void): Promise<SuiteReport> {
  const target = loaded.config.targets[targetId]!;
  const required = target.requiredSuites.includes(suiteId);
  const declared = loaded.config.suites[suiteId];
  const suite = declared ? { ...declared, ...target.suiteBindings?.[suiteId] } : undefined;
  const base: SuiteReport = { id: suiteId, required, status: 'infrastructure-error', detected: 0, cases: [] };
  try {
    if (!suite) throw new Error(`Unknown suite: ${suiteId}`);
    if (signal?.aborted) throw new Error('Suite cancelled before execution');
    if (suite.eulaRequired && !loaded.local.eulaAccepted) throw new Error('EULA acceptance is required before this suite can run');
    if (suite.driver === 'unsupported') return { ...base, status: 'unsupported', error: 'No verified driver configured for this suite' };
    const runtime = suite.runtime ? loaded.config.runtimes[suite.runtime] : undefined;
    const capabilities = [...(runtime?.capabilities ?? (suite.driver === 'gradle' ? ['gradle-task', 'test-results'] : [])), ...(suite.pilot ? fixtureCapabilities(target) : [])];
    const missing = (suite.requiredCapabilities ?? []).filter(capability => !capabilities.includes(capability));
    if (missing.length) return { ...base, status: 'unsupported', error: `Missing capabilities: ${missing.join(', ')}` };
    if (suite.driver === 'client-smoke' || suite.driver === 'fixture-multiplayer' || suite.driver === 'fixture-multi-client') {
      if (!runtime || !suite.pilot) throw new Error('Client suite requires a server runtime and pinned pilot configuration');
      const backendRoot = loaded.local.backends?.[suite.pilot.backend];
      if (!backendRoot) throw new Error(`Backend ${suite.pilot.backend} must be installed and configured in harness.local.json`);
      const backendIdentity = await validateMcPilotInstallation(backendRoot, loaded.lock.tools[suite.pilot.backend]!);
      const displayEnvironment = clientDisplayEnvironment();
      await resolveTool(loaded, suite.pilot.backend, signal);
      const helperPath = await resolveTool(loaded, suite.pilot.helper, signal);
      const helperSha256 = loaded.lock.tools[suite.pilot.helper]!.sha256;
      const driver = suite.driver === 'client-smoke' ? runClientSmoke : suite.driver === 'fixture-multi-client' ? runFixtureMultiClient : runFixtureMultiplayer;
      const result = await driver(loaded, targetId, runtime, artifacts, directory, path.join(directory, 'sessions', targetId, suiteId), { backendRoot, helperArtifact: { path: helperPath, sha256: helperSha256 }, signal, reportRoot: directory, assetCache: loaded.local.assetCaches?.[target.minecraft] ?? loaded.local.assetCache, onStorageUnitStopped, onStorageLeaseStopped });
      return { ...evaluateSuite(suiteId, suite, result.cases, required), logs: result.logs, evidence: result.evidence, runtimeMetadata: { ...result.metadata, backendIdentity, displayEnvironment } };
    }
    if (suite.driver === 'server-persistence') {
      if (!runtime || runtime.kind !== 'server') throw new Error('Persistence needs a dedicated server runtime');
      const result = await runServerPersistence(loaded, targetId, runtime, suite, artifacts, directory, path.join(directory, 'sessions', targetId, suiteId), signal);
      return { ...evaluateSuite(suiteId, suite, result.cases, required), logs: result.logs, evidence: result.evidence };
    }
    if (suite.driver === 'server-smoke') {
      if (!runtime || runtime.kind !== 'server') throw new Error('Server smoke requires a dedicated server runtime');
      const sessionRoot = path.join(directory, 'sessions', targetId, suiteId);
      const server = new OwnedServer(loaded, targetId, runtime, sessionRoot, path.join(directory, 'logs', targetId, suiteId));
      const cases: SuiteReport['cases'] = [];
      let failure: unknown;
      try {
        await server.prepare(artifacts, directory, signal); await server.start(signal); await server.waitReady();
        if (signal?.aborted) throw new Error('Server smoke cancelled');
        cases.push({ id: 'server.ready', status: 'passed' });
      } catch (error) { failure = error; }
      finally {
        const stopped = await server.stop();
        if (stopped) {
          base.logs = [relative(directory, stopped.logs.stdout), relative(directory, stopped.logs.stderr)];
          cases.push({ id: 'server.stopped', status: stopped.exitCode === 0 && !stopped.error && !signal?.aborted ? 'passed' : 'infrastructure-error', message: stopped.error ?? `Exit code: ${stopped.exitCode}` });
        }
        base.evidence = (await server.collectEvidence()).map(file => relative(directory, path.join(server.directory, file)));
      }
      if (failure) return { ...base, cases, detected: cases.length, error: (failure as Error).message };
      return { ...evaluateSuite(suiteId, suite, cases, required), logs: base.logs, evidence: base.evidence };
    }
    if (!suite.results) throw new Error('A suite needs a results file; exit code alone cannot prove test execution');
    const logDir = path.join(directory, 'logs', targetId, suiteId);
    const buildRoot = path.resolve(loaded.root, loaded.config.builds[target.build]!.root);
    const sessionRoot = path.join(directory, 'sessions', targetId, suiteId);
    await mkdir(sessionRoot, { recursive: true });
    const resultsRoot = suite.driver === 'gradle' ? buildRoot : sessionRoot;
    const resultFile = await containedResults(resultsRoot, suite.results);
    if (suite.driver !== 'gradle') {
      try { if (!(await stat(resultFile)).isFile()) throw new Error('Test results path is not a regular file'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rm(resultFile, { force: true });
    }
    let process: ProcessResult;
    let parseFile = resultFile;
    if (suite.driver === 'gradle') {
      const captured = await adapter.runTasksWithResults(targetId, suite.task!, suite.results, path.join(logDir, 'results'), { logDir, signal });
      process = captured.process;
      if (captured.resultFile) parseFile = captured.resultFile;
    }
    else {
      if (!runtime?.command) throw new Error('Process runtime requires an explicit command');
      const substitute = (value: string) => value.replaceAll('{projectRoot}', loaded.root).replaceAll('{sessionRoot}', sessionRoot).replaceAll('{target}', targetId).replaceAll('{runRoot}', directory);
      process = await runProcess({ executable: substitute(runtime.command.executable), args: runtime.command.args.map(substitute), cwd: sessionRoot,
        timeoutMs: loaded.local.timeouts?.test ?? 120_000, stopTimeoutMs: loaded.local.timeouts?.stop ?? 5_000, logDir, signal,
        env: { ...globalThis.process.env, MCH_PROJECT_ROOT: loaded.root, MCH_SESSION_ROOT: sessionRoot, MCH_TARGET: targetId, MCH_RUN_ROOT: directory }, redact: redactText });
    }
    base.logs = [relative(directory, process.logs.stdout), relative(directory, process.logs.stderr)];
    if (process.status !== 'passed') return { ...base, status: processStatus(process), error: process.error ?? `Test process ${process.status}, exit code ${process.exitCode}` };
    const resultPath = await realpath(parseFile);
    const rel = path.relative(await realpath(suite.driver === 'gradle' ? directory : resultsRoot), resultPath);
    if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) throw new Error('Test results escaped root');
    if (suite.driver === 'gradle') base.logs.push(relative(directory, parseFile));
    const cases = (await parseResults(parseFile)).map(test => ({ ...test, id: target.caseAliases?.[test.id] ?? test.id }));
    base.evidence = await retainResultDetails(cases, parseFile, directory);
    return { ...evaluateSuite(suiteId, suite, cases, required), logs: base.logs, evidence: base.evidence };
  } catch (error) { return { ...base, error: (error as Error).message }; }
}
