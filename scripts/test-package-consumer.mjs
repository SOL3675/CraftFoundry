import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!['--package', '--previous'].includes(key) || !value || options[key]) throw new Error('Usage: npm run test:consumer -- --package <tarball> [--previous <prior-tarball>]');
  options[key] = resolve(value);
}
if (!options['--package']) throw new Error('--package is required');
const directory = mkdtempSync(join(tmpdir(), 'Foundry packed consumer 日本語 '));
const npm = (...args) => {
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: directory, encoding: 'utf8' })
    : spawnSync('npm', args, { cwd: directory, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
};
try {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'foundry-packed-consumer', private: true, type: 'module' }));
  const packageRoot = join(directory, 'node_modules/craft-foundry');
  const destination = join(directory, '.agents/skills');
  const cli = (...args) => {
    const result = spawnSync(process.execPath, [join(packageRoot, 'dist/cli/main.js'), ...args], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const install = () => cli('skills', 'install', '--destination', destination, '--json');
  const metadata = () => JSON.parse(readFileSync(join(destination, '.mch-skills.json'), 'utf8'));
  let previous;
  if (options['--previous']) {
    npm('install', '--save-dev', '--save-exact', options['--previous'], '--ignore-scripts');
    install(); previous = metadata();
    writeFileSync(join(destination, 'project-setup/SKILL.md'), 'Consumer customization must survive the actual package upgrade\n');
  }
  npm('install', '--save-dev', '--save-exact', options['--package'], '--ignore-scripts');
  const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
  assert.equal(version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  const updated = install(), provenance = metadata();
  assert.equal(provenance.version, version);
  if (previous) {
    assert.equal(readFileSync(join(destination, 'project-setup/SKILL.md'), 'utf8'), 'Consumer customization must survive the actual package upgrade\n');
    assert.deepEqual(provenance.files['project-setup/SKILL.md'], previous.files['project-setup/SKILL.md']);
    for (const name of ['development-loop', 'porting', 'troubleshooting']) {
      const file = `${name}/SKILL.md`, bytes = readFileSync(join(destination, file));
      assert.equal(provenance.files[file].version, version);
      assert.equal(provenance.files[file].sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.match(bytes.toString(), /Forge\/Fabric 1\.20\.1|1\.20\.1 collectors/);
    }
  }
  assert.equal(metadata().version, version);
  const repeated = install();
  assert.deepEqual(repeated.installed, []); assert.deepEqual(repeated.updated, []);
  assert.deepEqual(repeated.preserved, previous ? ['project-setup/SKILL.md'] : []);
  const template = readFileSync(join(packageRoot, 'templates/acquisition/README.md'), 'utf8');
  assert.match(template, /yourmod:recipes\/press.json/);
  assert.match(template, /never establish exhaustive absence/);
  assert.match(template, /Forge fluid runtime behavior remains unverified/);
  const definitions = JSON.parse(readFileSync(join(packageRoot, 'templates/acquisition/definitions.json'), 'utf8'));
  assert.deepEqual([definitions.targets.loader, definitions.targets.minecraft], ['neoforge', '1.21.1']);
  assert.ok(!existsSync(join(packageRoot, 'projects')) && !existsSync(join(packageRoot, 'scripts/atlas-survival.mjs')));
  assert.ok(!existsSync(join(packageRoot, '.harness')) && !existsSync(join(packageRoot, 'harness.local.json')));
  // Resolve only the installed package's explicit exports, with no repository source imports.
  execFileSync(process.execPath, ['--input-type=module', '-e', "for (const part of ['core/config','core/cache','core/tools','core/types','adapters/runtime/server','adapters/runtime/mc-pilot']) await import('craft-foundry/' + part)"], { cwd: directory, encoding: 'utf8' });
  const listed = cli('targets', '--project', packageRoot, '--json');
  assert.ok(JSON.stringify(listed).includes('forge-1.20.1') && JSON.stringify(listed).includes('fabric-1.20.1'));
  console.log(JSON.stringify({ version, packageSha256: createHash('sha256').update(readFileSync(options['--package'])).digest('hex'), previousVersion: previous?.version ?? null, skills: updated, targets: 4, exports: 6, template: 'exact-target and finite boundaries verified' }));
} finally { rmSync(directory, { recursive: true, force: true }); }
