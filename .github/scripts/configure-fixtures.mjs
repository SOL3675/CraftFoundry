import { createHash } from 'node:crypto';
import { access, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../../dist/core/config.js';
import { assertContainedPath } from '../../dist/core/paths.js';

export async function configureFixtures(root = fileURLToPath(new URL('../../', import.meta.url)), env = process.env) {
  if (env.CI_EULA_ACCEPTED !== 'true') throw new Error('CI_EULA_ACCEPTED=true requires the explicit workflow EULA acceptance input');
  const projectRoot = await realpath(root);
  const installation = JSON.parse(await readFile(path.join(projectRoot, '.harness/ci/mc-pilot-install.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(projectRoot, 'harness.lock.json'), 'utf8'));
  if (installation.version !== lock.tools['mc-pilot'].version) throw new Error('Installed backend version differs from the shared tool pin');
  const java = {};
  for (const [role, key] of [['java17', 'MCH_JAVA17'], ['java21', 'MCH_JAVA21']]) {
    if (!env[key] || !path.isAbsolute(env[key])) throw new Error(`An absolute ${key} Java home is required`);
    await access(path.join(env[key], 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
    java[role] = env[key];
  }
  for (const [key, tool] of [['packageTarball', 'mc-pilot'], ['helperJar', 'mct-helper-fabric-1.21.1']]) {
    if (typeof installation[key] !== 'string') throw new Error(`Missing installation path: ${key}`);
    await assertContainedPath(projectRoot, installation[key]);
    const hash = createHash('sha256').update(await readFile(installation[key])).digest('hex');
    if (hash !== lock.tools[tool].sha256) throw new Error(`Installed ${tool} hash differs from the shared tool pin`);
  }
  if (typeof installation.backendRoot !== 'string') throw new Error('Missing installed backend root');
  await assertContainedPath(projectRoot, installation.backendRoot);
  const local = { schemaVersion: 1, java,
    tools: { 'mc-pilot': installation.packageTarball, 'mct-helper-fabric-1.21.1': installation.helperJar },
    backends: { 'mc-pilot': installation.backendRoot },
    timeouts: { build: 1_200_000, start: 180_000, test: 600_000, stop: 30_000 }, eulaAccepted: true };
  const output = path.join(projectRoot, 'harness.local.json');
  await assertContainedPath(projectRoot, output);
  await writeFile(output, `${JSON.stringify(local, null, 2)}\n`, { flag: 'wx' });
  await loadConfig(projectRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await configureFixtures();
