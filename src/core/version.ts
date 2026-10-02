import { readFileSync } from 'node:fs';

/** Read the installed package metadata so CLI, reports and Skills share a version. */
export const harnessVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
