import { access } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedConfig } from '../core/types.js';
import { runProcess } from '../platform/process.js';
import { redactText } from '../reporting/redact.js';
import { sha256File } from '../core/cache.js';
import { fixtureCapabilities, isFixtureTargetSupported } from '../adapters/test/multiplayer.js';
import { validateMcPilotInstallation } from '../core/tools.js';
import { clientDisplayEnvironment } from '../platform/display.js';

export interface Diagnostic { id: string; status: 'passed' | 'infrastructure-error' | 'unsupported'; message: string }
export async function doctor(loaded: LoadedConfig): Promise<{ schemaVersion: 1; status: string; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [{ id: 'node', status: process.versions.node.split('.')[0] === '24' ? 'passed' : 'infrastructure-error', message: `Node ${process.version}; supported major: 24` }];
  if (process.platform === 'linux' && Object.values(loaded.config.targets).some(target => target.requiredSuites.some(id => ['client-smoke', 'fixture-multiplayer', 'fixture-multi-client'].includes(loaded.config.suites[id]!.driver)))) {
    try { const display = clientDisplayEnvironment(); diagnostics.push({ id: 'display', status: 'passed', message: `X11 DISPLAY=${display.display}; actual rendering is verified by runtime suites` }); }
    catch (error) { diagnostics.push({ id: 'display', status: 'infrastructure-error', message: (error as Error).message }); }
  }
  for (const [id, build] of Object.entries(loaded.config.builds)) {
    const wrapper = path.join(loaded.root, build.root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    try { await access(wrapper); diagnostics.push({ id: `wrapper/${id}`, status: 'passed', message: `Gradle Wrapper found: ${build.root}` }); }
    catch { diagnostics.push({ id: `wrapper/${id}`, status: 'infrastructure-error', message: `Missing Gradle Wrapper: ${build.root}` }); }
  }
  const roles = new Set(Object.values(loaded.config.targets).flatMap(target => [target.java?.gradle, target.java?.game, loaded.config.builds[target.build]?.java]).filter((value): value is string => !!value));
  for (const role of roles) {
    const home = loaded.local.java?.[role];
    if (!home) { diagnostics.push({ id: `java/${role}`, status: 'infrastructure-error', message: 'Set Java home for this role in harness.local.json' }); continue; }
    const result = await runProcess({ executable: path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), args: ['-version'], cwd: loaded.root, timeoutMs: 10_000, logDir: path.join(loaded.root, '.harness', 'doctor', role), redact: redactText });
    diagnostics.push({ id: `java/${role}`, status: result.status === 'passed' ? 'passed' : 'infrastructure-error', message: result.status === 'passed' ? (result.stderr || result.stdout).trim() : result.error ?? 'Java could not start' });
  }
  if (!roles.size) diagnostics.push({ id: 'java/default', status: 'unsupported', message: 'No explicit Java roles; Gradle uses the inherited environment' });
  for (const [id, file] of Object.entries(loaded.local.tools ?? {})) {
    try {
      const actual = await sha256File(file);
      diagnostics.push({ id: `tool/${id}`, status: actual === loaded.lock.tools[id]?.sha256 ? 'passed' : 'infrastructure-error', message: actual === loaded.lock.tools[id]?.sha256 ? 'Pinned tool hash verified' : 'Tool hash mismatch' });
    } catch (error) { diagnostics.push({ id: `tool/${id}`, status: 'infrastructure-error', message: (error as Error).message }); }
  }
  for (const [id, backendRoot] of Object.entries(loaded.local.backends ?? {})) {
    try {
      const identity = await validateMcPilotInstallation(backendRoot, loaded.lock.tools[id]!);
      diagnostics.push({ id: `backend/${id}`, status: 'passed', message: `Verified ${identity.name} ${identity.version}; executable tree SHA-256 ${identity.treeSha256}` });
    } catch (error) { diagnostics.push({ id: `backend/${id}`, status: 'infrastructure-error', message: (error as Error).message }); }
  }
  for (const [id, target] of Object.entries(loaded.config.targets)) {
    for (const suiteId of target.requiredSuites) {
      const suite = { ...loaded.config.suites[suiteId]!, ...target.suiteBindings?.[suiteId] };
      if (suite.driver === 'unsupported') diagnostics.push({ id: `suite/${id}/${suiteId}`, status: 'unsupported', message: 'Required suite has no verified driver' });
      const runtime = suite.runtime ? loaded.config.runtimes[suite.runtime] : undefined;
      if (suite.pilot && !loaded.local.backends?.[suite.pilot.backend]) diagnostics.push({ id: `backend/${id}/${suiteId}`, status: 'infrastructure-error', message: `Install and configure backend ${suite.pilot.backend}` });
      if (suite.pilot && !isFixtureTargetSupported(target)) diagnostics.push({ id: `driver/${id}/${suiteId}`, status: 'unsupported', message: 'Fixture driver has not been verified for this exact Minecraft/loader version' });
      for (const capability of suite.requiredCapabilities ?? []) {
        if (![...(runtime?.capabilities ?? (suite.driver === 'gradle' ? ['gradle-task', 'test-results'] : [])), ...(suite.pilot ? fixtureCapabilities(target) : [])].includes(capability)) diagnostics.push({ id: `capability/${id}/${suiteId}`, status: 'unsupported', message: `Missing capability: ${capability}` });
      }
      if ((runtime || suite.eulaRequired) && !loaded.local.eulaAccepted) diagnostics.push({ id: `eula/${id}/${suiteId}`, status: 'infrastructure-error', message: 'Game runtime requires EULA acceptance; set eulaAccepted:true only after agreeing' });
    }
  }
  return { schemaVersion: 1, status: diagnostics.some(item => item.status !== 'passed') ? 'infrastructure-error' : 'passed', diagnostics };
}
