import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { lstat, mkdir, open, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sax from 'sax';
import type { Artifact, ArtifactManifest, BuildOutcome, LoadedConfig, ProcessResult } from '../../core/types.js';
import { validateArtifactManifest } from '../../core/config.js';
import { runProcess } from '../../platform/process.js';
import { gradleCommand } from '../../platform/gradle.js';
import { redact, redactText } from '../../reporting/redact.js';

export interface BuildOptions { logDir: string; signal?: AbortSignal }
export interface TaskResultsOutcome { process: ProcessResult; resultFile?: string }

const queues = new Map<string, Promise<void>>();

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function explicitPath(value: string): void {
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /[:\0]/.test(value) || /[*?\[\]{}]/.test(value)
    || value.split(/[\\/]/).includes('..')) {
    throw new Error(`An explicit relative file path is required: ${value}`);
  }
}

async function resultPath(root: string, relative: string): Promise<string> {
  explicitPath(relative);
  const file = path.resolve(root, relative);
  let parent = path.dirname(file);
  while (true) {
    try {
      if (!contained(root, await realpath(parent))) throw new Error(`Test result directory escapes build root: ${relative}`);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = path.dirname(parent);
      if (parent === next) throw error;
      parent = next;
    }
  }
}

function safeResultText(text: string, extension: '.json' | '.xml'): string {
  if (extension === '.json') return `${JSON.stringify(redact(JSON.parse(text)), null, 2)}\n`;
  const escape = (value: string) => value.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!);
  const parser = sax.parser(true);
  let output = '<?xml version="1.0" encoding="UTF-8"?>\n';
  parser.ondoctype = () => { throw new Error('DOCTYPE is not allowed in test reports'); };
  parser.onopentag = node => {
    const safeAttributes = redact(node.attributes) as Record<string, string>;
    if (node.name === 'property' && node.attributes.name !== undefined && node.attributes.value !== undefined) {
      const propertyName = String(node.attributes.name);
      safeAttributes.value = (redact({ [propertyName]: node.attributes.value }) as Record<string, string>)[propertyName]!;
    }
    const attributes = Object.entries(safeAttributes).map(([name, value]) => ` ${name}="${escape(String(value))}"`).join('');
    output += `<${node.name}${attributes}>`;
  };
  parser.onclosetag = name => { output += `</${name}>`; };
  parser.ontext = value => { output += escape(redactText(value)); };
  parser.oncdata = value => { output += escape(redactText(value)); };
  // Comments and processing instructions have no test meaning and are not persisted.
  parser.write(text).close();
  return `${output}\n`;
}

async function regularFile(root: string, relative: string): Promise<string> {
  explicitPath(relative);
  const resolved = await realpath(path.resolve(root, relative));
  if (!contained(root, resolved)) throw new Error(`File escapes build root: ${relative}`);
  if (!(await stat(resolved)).isFile()) throw new Error(`Expected a regular file: ${relative}`);
  return resolved;
}

/** Never steals a persistent lock: a crashed owner must be investigated by a human. */
async function exclusive<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const predecessor = queues.get(root) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => { release = resolve; });
  const queued = predecessor.then(() => tail);
  queues.set(root, queued);
  await predecessor;
  let owned = false;
  const token = randomUUID();
  const lockDir = path.join(root, '.harness');
  const lockFile = path.join(lockDir, 'build-adapter.lock');
  try {
    await mkdir(lockDir, { recursive: true });
    if (!contained(root, await realpath(lockDir))) throw new Error('Build lock directory escapes build root');
    try {
      const handle = await open(lockFile, 'wx');
      owned = true;
      try { await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: hostname(), startedAt: new Date().toISOString() })); }
      finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Build root is locked: ${lockFile}. Verify the recorded owner before removing a stale lock.`);
      }
      throw error;
    }
    return await operation();
  } finally {
    try {
      if (owned) {
        const current = JSON.parse(await readFile(lockFile, 'utf8')) as { token?: string };
        if (current.token !== token) throw new Error(`Build lock ownership changed: ${lockFile}`);
        await unlink(lockFile);
      }
    } finally {
      release();
      if (queues.get(root) === queued) queues.delete(root);
    }
  }
}

function failed(error: unknown, processResult?: ProcessResult): BuildOutcome {
  return { status: processResult?.status === 'passed' ? 'infrastructure-error' : (processResult?.status ?? 'infrastructure-error'),
    ...(processResult ? { process: processResult } : {}), artifacts: [], error: error instanceof Error ? error.message : String(error) };
}

export class GradleBuildAdapter {
  private loaded: LoadedConfig;
  private builtInputs = new Map<string, { manifest: string; hashes: string[] }>();
  constructor(loaded: LoadedConfig) { this.loaded = loaded; }

  private async context(targetId: string) {
    const target = this.loaded.config.targets[targetId];
    if (!target) throw new Error(`Unknown target: ${targetId}`);
    const build = this.loaded.config.builds[target.build];
    if (!build) throw new Error(`Unknown build: ${target.build}`);
    const projectRoot = await realpath(this.loaded.root);
    const root = await realpath(path.resolve(projectRoot, build.root));
    if (!contained(projectRoot, root)) throw new Error(`Build root escapes project: ${build.root}`);
    const javaRole = target.java?.gradle ?? build.java;
    const javaHome = javaRole ? this.loaded.local.java?.[javaRole] : undefined;
    if (javaRole && !javaHome) throw new Error(`Gradle Java role is not configured in harness.local.json: ${javaRole}`);
    return { target, root, env: { ...process.env,
      GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? path.join(projectRoot, '.harness', 'cache', 'gradle'),
      MCH_EULA_ACCEPTED: this.loaded.local.eulaAccepted ? 'true' : 'false',
      // Retain the environment property for compatible launchers; POSIX shells
      // may remove its dotted name, so execute also passes explicit -P and -D.
      ...(Object.keys(this.loaded.local.java ?? {}).length ? { 'ORG_GRADLE_PROJECT_org.gradle.java.installations.paths': Object.values(this.loaded.local.java!).join(',') } : {}),
      ...(javaHome ? { JAVA_HOME: javaHome } : {}) } };
  }

  private async execute(targetId: string, taskKey: string, options: BuildOptions, timeoutMs = this.loaded.local.timeouts?.build ?? 600_000): Promise<ProcessResult> {
    const { target, root, env } = await this.context(targetId);
    const tasks = target.tasks[taskKey];
    if (!tasks?.length) throw new Error(`Target ${targetId} has no tasks for ${taskKey}`);
    const javaHomes = Object.values(this.loaded.local.java ?? {});
    const javaPaths = javaHomes.join(',');
    const command = gradleCommand(root, [...(javaHomes.length ? [`-Dorg.gradle.java.installations.paths=${javaPaths}`, `-Porg.gradle.java.installations.paths=${javaPaths}`] : []), ...tasks]);
    return runProcess({ ...command, cwd: root, ...(env ? { env } : {}),
      timeoutMs, logDir: options.logDir, redact: redactText,
      ...(options.signal ? { signal: options.signal } : {}) });
  }

  private async manifest(targetId: string): Promise<ArtifactManifest> {
    const { target, root } = await this.context(targetId);
    const file = await regularFile(root, target.artifactManifest);
    const manifest = validateArtifactManifest(JSON.parse(await readFile(file, 'utf8')));
    if (manifest.target !== targetId || manifest.minecraft !== target.minecraft || manifest.loader !== target.loader) {
      throw new Error(`Resolved manifest does not match target ${targetId}: ${manifest.target}/${manifest.minecraft}/${manifest.loader}`);
    }
    if (target.loaderVersion && manifest.loaderVersion !== target.loaderVersion) throw new Error(`Resolved loader version does not match target ${targetId}: ${manifest.loaderVersion} (expected ${target.loaderVersion})`);
    if (!manifest.artifacts.some((artifact) => artifact.kind === 'distribution')) {
      throw new Error(`Manifest for ${targetId} has no distribution JAR`);
    }
    for (const artifact of manifest.artifacts) {
      if (!artifact.path.toLowerCase().endsWith('.jar')) throw new Error(`Artifact must identify an explicit JAR: ${artifact.path}`);
      if (artifact.kind === 'distribution' && /(?:^|[-_.])(sources?|dev(?:elopment)?|javadoc)(?:[-_.]|$)/i.test(path.basename(artifact.path))) {
        throw new Error(`Source/development JAR cannot be a distribution artifact: ${artifact.path}`);
      }
      await regularFile(root, artifact.path);
    }
    return manifest;
  }

  private async exportManifest(targetId: string, options: BuildOptions): Promise<ProcessResult> {
    const { target, root } = await this.context(targetId);
    explicitPath(target.artifactManifest);
    const file = path.resolve(root, target.artifactManifest);
    const identity = async () => {
      try {
        const info = await stat(file, { bigint: true });
        return `${info.mtimeNs}:${info.ctimeNs}:${info.size}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    };
    const previous = await identity();
    const result = await this.execute(targetId, 'inspect', options);
    if (result.status === 'passed' && previous !== undefined && previous === await identity()) {
      return { ...result, status: 'infrastructure-error', error: `Inspection did not refresh artifact manifest for ${targetId}: ${target.artifactManifest}` };
    }
    return result;
  }

  async runTasks(targetId: string, taskKey: string, options: BuildOptions): Promise<ProcessResult> {
    const { root } = await this.context(targetId);
    return exclusive(root, () => this.execute(targetId, taskKey, options));
  }

  /** Hold root ownership across stale-file removal, task execution and evidence capture. */
  async runTasksWithResults(targetId: string, taskKey: string, resultsRelative: string, destination: string, options: BuildOptions): Promise<TaskResultsOutcome> {
    const { root } = await this.context(targetId);
    return exclusive(root, async () => {
      const file = await resultPath(root, resultsRelative);
      try {
        if (!(await lstat(file)).isFile()) throw new Error(`Test results must be a regular file: ${resultsRelative}`);
        await regularFile(root, resultsRelative);
        await unlink(file);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const process = await this.execute(targetId, taskKey, options, this.loaded.local.timeouts?.test ?? 120_000);
      if (process.status !== 'passed') return { process };
      if (!(await lstat(file)).isFile()) throw new Error(`Test results must be a regular file: ${resultsRelative}`);
      const actual = await regularFile(root, resultsRelative);
      const extension = path.extname(resultsRelative).toLowerCase() === '.xml' ? '.xml' : '.json';
      const text = safeResultText(await readFile(actual, 'utf8'), extension);
      await mkdir(destination, { recursive: true });
      const resultFile = path.join(await realpath(destination), `result${extension}`);
      await writeFile(resultFile, text, { flag: 'wx' });
      return { process, resultFile };
    });
  }

  async inspect(targetId: string, options: BuildOptions): Promise<BuildOutcome> {
    try {
      const { target, root } = await this.context(targetId);
      return await exclusive(root, async () => {
        const result = target.tasks.inspect?.length ? await this.exportManifest(targetId, options) : undefined;
        if (result && result.status !== 'passed') return failed(result.error ?? 'Gradle inspection failed', result);
        try { return { status: 'passed', ...(result ? { process: result } : {}), manifest: await this.manifest(targetId), artifacts: [] }; }
        catch (error) { return failed(error, result); }
      });
    } catch (error) { return failed(error); }
  }

  async build(targetId: string, options: BuildOptions): Promise<BuildOutcome> {
    try {
      const { target, root } = await this.context(targetId);
      return await exclusive(root, async () => {
        this.builtInputs.delete(targetId);
        const result = await this.execute(targetId, 'build', { ...options, logDir: path.join(options.logDir, 'build') });
        if (result.status !== 'passed') return failed(result.error ?? 'Gradle build failed', result);
        let inspection: ProcessResult | undefined;
        try {
          if (target.tasks.inspect?.length) {
            inspection = await this.exportManifest(targetId, { ...options, logDir: path.join(options.logDir, 'inspect') });
            if (inspection.status !== 'passed') return failed(inspection.error ?? 'Gradle inspection failed', inspection);
          }
          const manifest = await this.manifest(targetId);
          const hashes = await Promise.all(manifest.artifacts.map(async (artifact) =>
            createHash('sha256').update(await readFile(await regularFile(root, artifact.path))).digest('hex')));
          this.builtInputs.set(targetId, { manifest: JSON.stringify(manifest), hashes });
          return { status: 'passed', process: result, manifest, artifacts: [] };
        } catch (error) { return failed(error, inspection ?? result); }
      });
    } catch (error) { return failed(error); }
  }

  async collectArtifacts(targetId: string, destination: string): Promise<Artifact[]> {
    const { root } = await this.context(targetId);
    return exclusive(root, async () => {
      const manifest = await this.manifest(targetId);
      // Read all files before creating snapshots, so a missing dependency leaves no partial set.
      const inputs = await Promise.all(manifest.artifacts.map(async (artifact) => {
        const file = await regularFile(root, artifact.path);
        return { artifact, data: await readFile(file) };
      }));
      const built = this.builtInputs.get(targetId);
      if (built && (built.manifest !== JSON.stringify(manifest) || inputs.some((input, index) =>
        createHash('sha256').update(input.data).digest('hex') !== built.hashes[index]))) {
        throw new Error(`Artifacts changed after build for ${targetId}; rebuild before collecting this run's evidence`);
      }
      await mkdir(destination, { recursive: true });
      const outputRoot = await realpath(destination);
      const artifacts: Artifact[] = [];
      for (const { artifact, data } of inputs) {
        const sha256 = createHash('sha256').update(data).digest('hex');
        const relative = `${sha256}-${path.basename(artifact.path.replaceAll('\\', '/'))}`;
        const output = path.join(outputRoot, relative);
        try { await writeFile(output, data, { flag: 'wx' }); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (!(await stat(output)).isFile() || !contained(outputRoot, await realpath(output))
            || createHash('sha256').update(await readFile(output)).digest('hex') !== sha256) {
            throw new Error(`Existing artifact snapshot is not identical: ${output}`);
          }
        }
        artifacts.push({ path: relative, sha256, size: data.length, kind: artifact.kind, side: artifact.side, originalPath: artifact.path });
      }
      const metadata = JSON.stringify({ schemaVersion: 1, target: targetId, minecraft: manifest.minecraft,
        loader: manifest.loader, ...(manifest.loaderVersion ? { loaderVersion: manifest.loaderVersion } : {}),
        ...(manifest.mappings ? { mappings: manifest.mappings } : {}), artifacts }, null, 2) + '\n';
      const metadataHash = createHash('sha256').update(metadata).digest('hex');
      const metadataFile = path.join(outputRoot, `artifacts-${metadataHash}.json`);
      try { await writeFile(metadataFile, metadata, { flag: 'wx' }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!(await stat(metadataFile)).isFile() || !contained(outputRoot, await realpath(metadataFile))
          || await readFile(metadataFile, 'utf8') !== metadata) throw new Error(`Existing artifact metadata is not identical: ${metadataFile}`);
      }
      return artifacts;
    });
  }
}
