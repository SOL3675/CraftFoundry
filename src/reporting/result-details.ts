import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertContainedPath } from '../core/paths.js';
import type { TestCase } from './types.js';

/** Input references are relative to the result file; retained references to the Run.
 * Validate each distinct companion once, preserving its complete bytes in place.
 */
export async function retainResultDetails(cases: TestCase[], resultFile: string, runRoot: string): Promise<string[]> {
  const files = new Map<string, unknown>();
  const evidence = new Set<string>();
  for (const test of cases) {
    if (!test.detail) continue;
    const file = path.resolve(path.dirname(resultFile), test.detail.file);
    await assertContainedPath(runRoot, file);
    if (!files.has(file)) {
      if (!(await stat(file)).isFile()) throw new Error('Case detail is not a regular file');
      files.set(file, JSON.parse(await readFile(file, 'utf8')));
    }
    let value = files.get(file);
    for (const token of test.detail.pointer === '' ? [] : test.detail.pointer.slice(1).split('/')) {
      const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('Case detail pointer does not resolve');
      value = (value as Record<string, unknown>)[key];
    }
    const relative = path.relative(runRoot, file).replaceAll('\\', '/');
    test.detail = { ...test.detail, file: relative };
    evidence.add(relative);
  }
  if (evidence.size) {
    await assertContainedPath(runRoot, resultFile);
    evidence.add(path.relative(runRoot, resultFile).replaceAll('\\', '/'));
  }
  return [...evidence];
}
