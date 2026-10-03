import assert from 'node:assert/strict';
import test from 'node:test';
import { gradleCommand } from '../dist/platform/gradle.js';
import { quoteWindowsArgument, windowsBatchCommand } from '../dist/platform/windows.js';
import { resolve } from 'node:path';

test('wrapper selection preserves tasks, spaces and Japanese paths', () => {
  const root = resolve('build root 日本語');
  assert.deepEqual(gradleCommand(root, [':fabric:build', '-Pkey=some value'], 'win32'), { executable: resolve(root, 'gradlew.bat'), args: ['--no-daemon', '--console=plain', ':fabric:build', '-Pkey=some value'] });
  assert.deepEqual(gradleCommand(root, ['build'], 'linux'), { executable: '/bin/sh', args: [resolve(root, 'gradlew'), '--no-daemon', '--console=plain', 'build'] });
  assert.throws(() => gradleCommand(root, []), /Gradle tasks/u);
});

test('Windows batch input rejects expansion and shell injection', () => {
  for (const unsafe of ['%PATH%', '!name!', 'one&two', 'one|two', '^x', '"', '>file', '<file', 'line\nnext']) {
    assert.throws(() => windowsBatchCommand('gradlew.bat', [unsafe]), /Unsafe/u);
  }
  assert.throws(() => windowsBatchCommand('path & other/gradlew.bat', []), /Unsafe/u);
  assert.equal(windowsBatchCommand('some folder 日本語/gradlew.bat', ['-Pmessage=hello world']).args.at(-1), '""some folder 日本語/gradlew.bat" "-Pmessage=hello world""');
});

test('ordinary executable arguments use CRT quoting without shell expansion', () => {
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.equal(quoteWindowsArgument('C:\\space path\\'), '"C:\\space path\\\\"');
  assert.equal(quoteWindowsArgument('value & %PATH%'), '"value & %PATH%"');
});
