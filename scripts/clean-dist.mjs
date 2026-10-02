import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const output = path.join(root, 'dist');
if (existsSync(output)) {
  if (lstatSync(output).isSymbolicLink() || realpathSync(output).toLowerCase() !== output.toLowerCase()) {
    throw new Error('Refusing to clean a redirected dist directory');
  }
  rmSync(output, { recursive: true });
}
