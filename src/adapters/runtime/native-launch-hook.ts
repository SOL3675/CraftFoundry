import { createRequire, syncBuiltinESMExports } from 'node:module';
import type { spawn as Spawn } from 'node:child_process';
import { prepareNativeArguments } from './native-paths.js';

// Preloaded into the session's launcher Node, before @xmcl imports spawn.
if (process.platform === 'win32') {
  const children = createRequire(import.meta.url)('node:child_process') as { spawn: typeof Spawn };
  const original = children.spawn;
  children.spawn = ((executable: string, args: readonly string[], options: Record<string, unknown> = {}) => {
    const nativeArgs = prepareNativeArguments(args, process.env.MCT_CACHE_DIR ?? '', process.env.MCH_NATIVE_OWNER ?? '');
    return original(executable, nativeArgs, { ...options, detached: false, windowsHide: true });
  }) as typeof Spawn;
  syncBuiltinESMExports();
}
