import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertContainedPath } from '../core/paths.js';
import type { TestCase } from './types.js';
import { sha256File } from '../core/cache.js';

function resolvePointer(value: unknown, pointer: string): unknown {
  for (const token of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('Case detail pointer does not resolve');
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function isStopReason(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const reason = value as Record<string, unknown>;
  return ['kind', 'target', 'process', 'message'].every(key => typeof reason[key] === 'string')
    && Array.isArray(reason.evidence) && reason.evidence.every(item => typeof item === 'string');
}

/** The new evidence layout has its own version. Legacy evidence remains readable;
 * a missing shared array or an unknown evidence contract must never look complete.
 */
function validateDiagnosticCounts(root: unknown, value: unknown, test: TestCase): void {
  if (!test.diagnostics) return;
  const evidence = root as { schemaVersion?: number; diagnosticContractVersion?: number; incomplete?: unknown } | null;
  const detail = value as { incomplete?: unknown; incompleteRef?: string; analysis?: { unknown?: unknown; stopReasons?: unknown } } | null;
  const incomplete = evidence?.schemaVersion === 2 && evidence.diagnosticContractVersion === 1 && detail?.incompleteRef === '#/incomplete'
    ? evidence.incomplete : evidence?.schemaVersion === 1 && evidence.diagnosticContractVersion === undefined ? detail?.incomplete : undefined;
  const unknown = detail?.analysis?.unknown, stops = detail?.analysis?.stopReasons;
  if (!Array.isArray(incomplete) || incomplete.some(reason => typeof reason !== 'string') || !Array.isArray(unknown) || unknown.some(reason => typeof reason !== 'string') || !Array.isArray(stops) || !stops.every(isStopReason)) throw new Error('Invalid or unsupported survival detail evidence contract');
  const counts = test.diagnostics.counts;
  if (counts.incomplete !== incomplete.length || counts.unknown !== unknown.length || counts.stopReasons !== stops.length) throw new Error('Survival diagnostic counts do not match complete evidence');
}

/** Validate result- or Run-relative references without rebasing them or changing bytes. */
export async function validateCaseDetails(cases: TestCase[], referenceRoot: string, allowedRoot = referenceRoot): Promise<string[]> {
  const files = new Map<string, unknown>();
  for (const test of cases) {
    if (test.diagnostics && !test.detail) throw new Error('Survival diagnostics require a complete detail reference');
    if (!test.detail) continue;
    const file = path.resolve(referenceRoot, test.detail.file);
    await assertContainedPath(allowedRoot, file);
    if (!files.has(file)) {
      if (!(await stat(file)).isFile()) throw new Error('Case detail is not a regular file');
      files.set(file, JSON.parse(await readFile(file, 'utf8')));
    }
    const root = files.get(file);
    validateDiagnosticCounts(root, resolvePointer(root, test.detail.pointer), test);
  }
  const retained = new Set(files.keys());
  for (const [companion, root] of files) {
    const capture = (root as { captureEvidence?: { schemaVersion: number; files: Array<{ file: string; sha256: string }> } })?.captureEvidence;
    if (!capture) continue;
    if (capture.schemaVersion !== 1 || !Array.isArray(capture.files) || !capture.files.length) throw new Error('Missing or unsupported capture evidence manifest');
    for (const entry of capture.files) {
      if (typeof entry.file !== 'string' || !entry.file || path.isAbsolute(entry.file) || entry.file.includes('\\') || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid capture evidence identity');
      const target = path.resolve(path.dirname(companion), entry.file);
      await assertContainedPath(allowedRoot, target);
      if (!(await stat(target)).isFile() || await sha256File(target) !== entry.sha256) throw new Error(`Missing or tampered capture evidence: ${entry.file}`);
      retained.add(target);
    }
  }
  return [...retained];
}

/** Input references are relative to the result file; retained references to the Run.
 * Validate each distinct companion once, preserving its complete bytes in place.
 */
export async function retainResultDetails(cases: TestCase[], resultFile: string, runRoot: string): Promise<string[]> {
  const files = await validateCaseDetails(cases, path.dirname(resultFile), runRoot);
  const evidence = new Set<string>();
  for (const test of cases) {
    if (!test.detail) continue;
    const file = path.resolve(path.dirname(resultFile), test.detail.file);
    const relative = path.relative(runRoot, file).replaceAll('\\', '/');
    test.detail = { ...test.detail, file: relative };
    evidence.add(relative);
  }
  if (files.length) {
    await assertContainedPath(runRoot, resultFile);
    evidence.add(path.relative(runRoot, resultFile).replaceAll('\\', '/'));
  }
  for (const file of files) evidence.add(path.relative(runRoot, file).replaceAll('\\', '/'));
  return [...evidence];
}
