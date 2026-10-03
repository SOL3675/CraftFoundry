import { resolve } from 'node:path';

/** Use the project's wrapper rather than a globally installed Gradle. */
export function gradleCommand(buildRoot: string, tasks: string[], platform: NodeJS.Platform = process.platform): { executable: string; args: string[] } {
  if (tasks.length === 0 || tasks.some(task => !task || /[\r\n\0]/u.test(task))) {
    throw new Error('Gradle tasks must be a non-empty array of non-empty arguments');
  }
  const wrapper = resolve(buildRoot, platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  // npm archives produced on Windows cannot reliably preserve executable bits.
  // The canonical Gradle wrapper is a POSIX sh script, so use its interpreter.
  return platform === 'win32'
    ? { executable: wrapper, args: ['--no-daemon', '--console=plain', ...tasks] }
    : { executable: '/bin/sh', args: [wrapper, '--no-daemon', '--console=plain', ...tasks] };
}
