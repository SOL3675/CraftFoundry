#!/usr/bin/env node
import path from 'node:path';
import { harnessVersion as version } from '../core/version.js';
import { loadConfig, ConfigError } from '../core/config.js';
import { executeRun } from '../core/runner.js';
import { doctor } from './doctor.js';
import { readReport } from '../reporting/report.js';
import { redact } from '../reporting/redact.js';
import { installSkills } from '../core/skills.js';
import { installMcPilot } from '../core/tools.js';

const usage = `CraftFoundry ${version} — Minecraft mod development harness (mch)

mch doctor [--json]
mch targets [--json]
mch inspect (--target <id> | --all) [--json]
mch build (--target <id> | --all) [--json]
mch test --target <id> [--suite <id>] [--json]
mch test --all --profile release [--json]
mch report --run <id> [--json]
mch skills install --destination <directory> [--json]
mch tools install mc-pilot [--project <directory>] [--json]

Global: --project <directory>, --help, --version
`;
function output(value: unknown, json: boolean): void {
  const safe = redact(value);
  if (json) process.stdout.write(`${JSON.stringify(safe)}\n`);
  else process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || !args.length) { process.stdout.write(usage); return; }
  if (args.length === 1 && args[0] === '--version') { process.stdout.write(`${version}\n`); return; }
  const json = args.includes('--json');
  try {
    const command = args.shift();
    if (!command || !['doctor', 'targets', 'inspect', 'build', 'test', 'report', 'skills', 'tools'].includes(command)) throw new Error(`Unknown command: ${command}`);
    if (command === 'skills' && args.shift() !== 'install') throw new Error('skills requires the install subcommand');
    if (command === 'tools' && (args.shift() !== 'install' || args.shift() !== 'mc-pilot')) throw new Error('tools requires install mc-pilot');
    const flags = new Map<string, string[]>();
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]!;
      if (!['--json', '--all', '--target', '--suite', '--profile', '--run', '--project', '--destination', '--npm-command'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
      const value = ['--json', '--all'].includes(flag) ? 'true' : args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flags.has(flag) && flag !== '--suite') throw new Error(`Duplicate option: ${flag}`);
      flags.set(flag, [...(flags.get(flag) ?? []), value]);
    }
    const allowed: Record<string, string[]> = { doctor: [], targets: [], inspect: ['--target', '--all'], build: ['--target', '--all'], test: ['--target', '--all', '--suite', '--profile'], report: ['--run'], skills: ['--destination'], tools: ['--npm-command'] };
    for (const flag of flags.keys()) if (!['--json', '--project', ...allowed[command]!].includes(flag)) throw new Error(`${flag} is not valid for ${command}`);
    const root = path.resolve(flags.get('--project')?.[0] ?? process.cwd());
    if (command === 'tools') {
      const controller = new AbortController(); const cancel = () => controller.abort();
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
      try { output({ schemaVersion: 1, ...await installMcPilot(root, { npmCommand: flags.get('--npm-command')?.[0], signal: controller.signal }) }, json); }
      finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
      return;
    }
    if (command === 'skills') {
      const destination = flags.get('--destination')?.[0];
      if (!destination) throw new Error('skills install requires an explicit --destination');
      output({ schemaVersion: 1, ...await installSkills(path.resolve(root, destination)) }, json); return;
    }
    if (command === 'report') {
      const id = flags.get('--run')?.[0]; if (!id) throw new Error('report requires --run');
      output(await readReport(root, id), json); return;
    }
    const loaded = await loadConfig(root);
    if (command === 'targets') { output({ schemaVersion: 1, targets: Object.entries(loaded.config.targets).map(([id, target]) => ({ id, ...target })) }, json); return; }
    if (command === 'doctor') { const result = await doctor(loaded); output(result, json); if (result.status !== 'passed') process.exitCode = 2; return; }
    if (flags.has('--all') && flags.has('--target')) throw new Error('Use either --all or --target');
    const targets = flags.has('--all') ? Object.keys(loaded.config.targets) : flags.get('--target') ?? [];
    if (!targets.length) throw new Error(`${command} requires --target or --all`);
    for (const id of targets) if (!Object.hasOwn(loaded.config.targets, id)) throw new Error(`Unknown target: ${id}`);
    const profile = flags.get('--profile')?.[0];
    if (profile && profile !== 'release') throw new Error('Only profile release is defined');
    if (profile && flags.has('--suite')) throw new Error('release profile always executes every required suite; --suite cannot restrict it');
    const controller = new AbortController();
    const cancel = () => { process.stderr.write('Cancelling run; collecting evidence and stopping owned processes…\n'); controller.abort(); };
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      process.stderr.write(`${command}: ${targets.join(', ')}\n`);
      const report = await executeRun(loaded, { command: command as 'build' | 'inspect' | 'test', targets, suites: flags.get('--suite'), profile: profile as 'release' | undefined, signal: controller.signal });
      output(report, json);
      if (report.status !== 'passed') process.exitCode = report.status === 'failed' ? 1 : 2;
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
  } catch (error) {
    output({ schemaVersion: 1, status: 'infrastructure-error', error: (error as Error).message,
      ...(error instanceof ConfigError ? { code: error.code, diagnostics: error.diagnostics } : {}) }, json);
    process.exitCode = 2;
  }
}
await main();
