import type { Artifact, CaseResult } from '../core/types.js';

export type CaseStatus = 'passed' | 'failed' | 'unsupported' | 'skipped' | 'infrastructure-error';
export interface TestCase extends CaseResult {
  attempts?: Array<{ status: CaseStatus; message?: string }>;
}
export interface SuiteReport {
  id: string;
  required: boolean;
  status: CaseStatus;
  detected: number;
  cases: TestCase[];
  error?: string;
  logs?: string[];
  evidence?: string[];
  runtimeMetadata?: Record<string, unknown>;
}
export interface TargetReport {
  id: string;
  minecraft: string;
  loader: string;
  status: CaseStatus;
  artifacts: Artifact[];
  suites: SuiteReport[];
  error?: string;
  resolved?: unknown;
}
export interface RunReport {
  schemaVersion: 1;
  id: string;
  command: string;
  startedAt: string;
  finishedAt?: string;
  status: CaseStatus;
  harnessVersion: string;
  platform: { os: string; arch: string; node: string };
  source: { revision?: string; diffSha256?: string; diffPath?: string; untrackedManifest?: string; untrackedSha256?: string; dirty?: boolean; limitations: string[] };
  configuration: unknown;
  lock: unknown;
  targets: TargetReport[];
  reproduction: { command: string; limitations: string[] };
  error?: string;
}
