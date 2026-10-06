/** Versioned configuration and adapter contracts. Paths in shared files are project-relative. */
export type Loader = 'fabric' | 'forge' | 'neoforge';
export type Side = 'client' | 'server' | 'both';
export type ArtifactKind = 'distribution' | 'runtime-dependency' | 'sources' | 'development';
export type CaseStatus = 'passed' | 'failed' | 'unsupported' | 'skipped' | 'infrastructure-error';
export type ProcessStatus = 'passed' | 'failed' | 'timed-out' | 'cancelled' | 'infrastructure-error';

export interface JavaRoles { gradle?: string; toolchain?: number; game?: string }
export interface BuildConfig { root: string; adapter: 'gradle'; java?: string }
export interface TargetConfig {
  minecraft: string;
  loader: Loader;
  loaderVersion?: string;
  build: string;
  tasks: Record<string, string[]>;
  artifactManifest: string;
  requiredSuites: string[];
  java?: JavaRoles;
  caseAliases?: Record<string, string>;
  suiteBindings?: Record<string, { runtime?: string; pilot?: { backend: string; helper: string } }>;
}
export interface SuiteConfig {
  driver: 'gradle' | 'process' | 'server-smoke' | 'client-smoke' | 'fixture-multiplayer' | 'fixture-multi-client' | 'unsupported';
  task?: string;
  requiredCapabilities?: string[];
  expectedTests?: string[];
  minTests?: number;
  eulaRequired?: boolean;
  results?: string;
  runtime?: string;
  pilot?: { backend: string; helper: string };
}
export interface RuntimeConfig {
  kind: 'server' | 'client' | 'multiplayer';
  capabilities: string[];
  command?: { executable: string; args: string[] };
  setup?: { executable: string; args: string[] };
  readyPattern?: string;
}
export interface HarnessConfig {
  schemaVersion: 1;
  projectId: string;
  builds: Record<string, BuildConfig>;
  targets: Record<string, TargetConfig>;
  suites: Record<string, SuiteConfig>;
  runtimes: Record<string, RuntimeConfig>;
}
export interface LocalConfig {
  schemaVersion: 1;
  assetCache?: string;
  assetCaches?: Record<string, string>;
  java?: Record<string, string>;
  tools?: Record<string, string>;
  backends?: Record<string, string>;
  timeouts?: { build?: number; start?: number; test?: number; stop?: number };
  eulaAccepted?: boolean;
}
export interface HarnessLock {
  schemaVersion: 1;
  tools: Record<string, { version: string; sha256: string; url?: string }>;
}
export interface LoadedConfig { root: string; config: HarnessConfig; local: LocalConfig; lock: HarnessLock }
export interface ArtifactManifest {
  schemaVersion: 1;
  target: string;
  minecraft: string;
  loader: Loader;
  loaderVersion?: string;
  mappings?: string;
  java?: JavaRoles;
  buildEnvironment?: { gradleVersion: string; gradleJavaVersion: string; compilerJavaVersion: string };
  artifacts: Array<{ path: string; kind: ArtifactKind; side: Side }>;
  classpath?: string[];
  sources?: string[];
}
export interface Artifact { path: string; sha256: string; size: number; kind: ArtifactKind; side: Side; originalPath: string }
export interface ProcessResult {
  status: ProcessStatus;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  logs: { stdout: string; stderr: string };
  error?: string;
}
export interface AdapterOptions { logDir: string; signal?: AbortSignal }
export interface BuildOutcome { status: ProcessStatus; process?: ProcessResult; artifacts: Artifact[]; manifest?: ArtifactManifest; error?: string }
export interface BuildAdapter {
  inspect(targetId: string, options: AdapterOptions): Promise<BuildOutcome>;
  build(targetId: string, options: AdapterOptions): Promise<BuildOutcome>;
  collectArtifacts(targetId: string, destination: string): Promise<Artifact[]>;
}
export interface CaseResult {
  id: string;
  status: CaseStatus;
  message?: string;
  durationMs?: number;
  detail?: { file: string; pointer: string };
  diagnostics?: { schemaVersion: 1; counts: { incomplete: number; unknown: number; stopReasons: number } };
}
export interface SuiteResult {
  id: string;
  status: CaseStatus;
  required: boolean;
  detectedTests: number;
  cases: CaseResult[];
  error?: string;
  evidence?: string[];
}
export interface RuntimeSession {
  id: string;
  target: string;
  runtime: string;
  directory: string;
  owner: string;
  capabilities: string[];
}
export interface RuntimeAdapter {
  prepare(targetId: string, runtimeId: string, options: AdapterOptions): Promise<RuntimeSession>;
  start(session: RuntimeSession, options: AdapterOptions): Promise<void>;
  waitReady(session: RuntimeSession, options: AdapterOptions): Promise<void>;
  stop(session: RuntimeSession, options: AdapterOptions): Promise<void>;
  collectEvidence(session: RuntimeSession, destination: string): Promise<string[]>;
}
export interface TestDriver {
  capabilities(targetId: string): string[];
  runSuite(targetId: string, suiteId: string, session: RuntimeSession | undefined, options: AdapterOptions): Promise<SuiteResult>;
}
