import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const canonical = 'https://github.com/SOL3675/CraftAtlas.git';
const run = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const pin = run(['ls-tree', 'HEAD', 'projects/craft-atlas']).match(/^160000 commit ([0-9a-f]{40})\tprojects\/craft-atlas$/)?.[1];
if (!pin || run(['config', '-f', '.gitmodules', '--get', 'submodule.projects/craft-atlas.url']) !== canonical) throw new Error('Invalid Atlas submodule identity');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--pin') {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `commit=${pin}\n`);
  console.log(pin);
} else {
  if (args.length && !(args.length === 2 && args[0] === '--source' && args[1])) throw new Error('Usage: node .github/scripts/prepare-atlas.mjs [--pin | --source <authenticated-checkout>]');
  try {
    if (args.length) {
      const source = resolve(args[1]);
      if (run(['rev-parse', 'HEAD'], source) !== pin) throw new Error('Authenticated Atlas source differs from the gitlink');
      // One command-local URL override: no token transfer or persistent credential configuration.
      run(['-c', 'protocol.file.allow=always', '-c', `submodule.projects/craft-atlas.url=${source}`, 'submodule', 'update', '--init', '--', 'projects/craft-atlas']);
      run(['submodule', 'sync', '--', 'projects/craft-atlas']);
    } else run(['submodule', 'update', '--init', '--', 'projects/craft-atlas']);
  } catch (error) {
    throw new Error('Cannot initialize private CraftAtlas. Supply an existing read-only CRAFTATLAS_READ_TOKEN in Foundry Actions (selected Atlas repository, Contents: read), or use an already authorized checkout via --source. No Atlas integration checks have passed.', { cause: error });
  }
  if (run(['rev-parse', 'HEAD'], resolve(root, 'projects/craft-atlas')) !== pin) throw new Error('Atlas submodule pin mismatch');
  const parentPin = JSON.parse(readFileSync(resolve(root, 'projects/craft-atlas/craft-foundry.source.json'), 'utf8'));
  console.log(`Atlas ${pin}; independent Foundry consumer pin ${parentPin.commit}`);
}
