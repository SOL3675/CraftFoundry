import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sax from 'sax';
import type { SuiteConfig } from '../../core/types.js';
import type { SuiteReport, TestCase } from '../../reporting/types.js';
import { validateCaseDetails } from '../../reporting/result-details.js';

const statuses = new Set(['passed', 'failed', 'unsupported', 'skipped', 'infrastructure-error']);
const evidencePath = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f\u007f]+\.json$/;
const pointer = /^(?:\/(?:[^~\u0000-\u001f\u007f]|~[01])*)*$/;
const invalidUnicode = /[\uD800-\uDFFF\ufffe\uffff]/u;
export async function parseResults(file: string): Promise<TestCase[]> {
  const input = await readFile(file, 'utf8');
  if (path.extname(file) !== '.xml') {
    const result = JSON.parse(input) as { schemaVersion?: number; cases?: TestCase[] };
    if (result.schemaVersion !== 1 || !Array.isArray(result.cases)) throw new Error('Test results require schemaVersion:1 and cases array');
    for (const test of result.cases) {
      if (!test || typeof test.id !== 'string' || !test.id || !statuses.has(test.status)) throw new Error('Invalid test case ID/status');
      if (Object.keys(test).some(key => !['id', 'status', 'message', 'durationMs', 'attempts', 'detail', 'diagnostics'].includes(key))) throw new Error('Unknown test case property');
      if (test.message !== undefined && typeof test.message !== 'string') throw new Error('Invalid test case message');
      if (test.detail !== undefined && (!test.detail || typeof test.detail.file !== 'string' || test.detail.file.length > 1024 || invalidUnicode.test(test.detail.file) || !evidencePath.test(test.detail.file) || typeof test.detail.pointer !== 'string' || test.detail.pointer.length > 256 || invalidUnicode.test(test.detail.pointer) || !pointer.test(test.detail.pointer) || Object.keys(test.detail).some(key => !['file', 'pointer'].includes(key)))) throw new Error('Invalid test case detail reference');
      if (test.diagnostics !== undefined) {
        const d = test.diagnostics;
        if (!d || d.schemaVersion !== 1 || !d.counts || Object.keys(d).some(key => !['schemaVersion', 'counts'].includes(key)) || Object.keys(d.counts).length !== 3 || !['incomplete', 'unknown', 'stopReasons'].every(key => Number.isSafeInteger(d.counts[key as keyof typeof d.counts]) && d.counts[key as keyof typeof d.counts] >= 0)) throw new Error('Invalid test case diagnostics');
      }
      if (test.durationMs !== undefined && (typeof test.durationMs !== 'number' || !Number.isFinite(test.durationMs) || test.durationMs < 0)) throw new Error('Invalid test case duration');
      if (test.attempts !== undefined && (!Array.isArray(test.attempts) || test.attempts.some(attempt => !attempt || !statuses.has(attempt.status) || attempt.message !== undefined && typeof attempt.message !== 'string' || Object.keys(attempt).some(key => !['status', 'message'].includes(key))))) throw new Error('Invalid test attempt metadata');
      if (test.attempts?.some(attempt => attempt.status !== 'passed') && test.status === 'passed') {
        test.status = 'failed'; test.message = 'Retry passed after an earlier failure; this case is not a stable pass';
      }
    }
    await validateCaseDetails(result.cases, path.dirname(file));
    return result.cases;
  }
  const cases: TestCase[] = [];
  const parser = sax.parser(true, { trim: true });
  let current: TestCase | undefined;
  let text = '';
  parser.ondoctype = () => { throw new Error('DOCTYPE is not allowed in test reports'); };
  parser.onopentag = node => {
    if (node.name === 'testcase') {
      const name = String(node.attributes.name ?? '');
      if (!name || current) throw new Error('Malformed testcase');
      const className = String(node.attributes.classname ?? '');
      const seconds = Number(node.attributes.time ?? 0);
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid JUnit testcase duration');
      current = { id: className ? `${className}.${name}` : name, status: 'passed', durationMs: seconds * 1000 };
    } else if (current && ['failure', 'error', 'skipped'].includes(node.name)) {
      current.status = node.name === 'failure' ? 'failed' : node.name === 'error' ? 'infrastructure-error' : 'skipped';
      current.message = String(node.attributes.message ?? ''); text = '';
    }
  };
  parser.ontext = value => { text += value; };
  parser.onclosetag = name => {
    if (current && ['failure', 'error', 'skipped'].includes(name) && text) current.message = `${current.message}\n${text}`.trim();
    if (name === 'testcase' && current) { cases.push(current); current = undefined; }
  };
  parser.write(input).close();
  return cases;
}

export function evaluateSuite(id: string, config: SuiteConfig, cases: TestCase[], required: boolean): SuiteReport {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const test of cases) { if (ids.has(test.id)) errors.push(`Duplicate case ${test.id}`); ids.add(test.id); }
  if (cases.length < (config.minTests ?? 1)) errors.push(`Detected ${cases.length} cases; minimum is ${config.minTests ?? 1}`);
  for (const expected of config.expectedTests ?? []) if (!ids.has(expected)) errors.push(`Expected case not detected: ${expected}`);
  if (required && cases.some(test => test.status === 'unsupported' || test.status === 'skipped')) errors.push('Required suite contains unsupported or unexecuted cases');
  const status = errors.length || cases.some(test => test.status === 'failed') ? 'failed'
    : cases.some(test => test.status === 'infrastructure-error') ? 'infrastructure-error'
    : cases.every(test => test.status === 'passed') && cases.length > 0 ? 'passed' : 'skipped';
  return { id, required, status, detected: cases.length, cases, ...(errors.length ? { error: errors.join('; ') } : {}) };
}
