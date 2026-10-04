import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--atlas-source' && args[1])) throw new Error('Usage: npm run test:atlas:definitions -- [--atlas-source <reviewed local Atlas checkout>]');
const source = resolve(args[1] ?? resolve(root, 'projects/craft-atlas'));
const child = spawnSync(process.execPath, ['--test', 'tests/atlas-definitions/*.test.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, CRAFTATLAS_DEFINITION_SOURCE: source },
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
