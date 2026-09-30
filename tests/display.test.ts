import test from 'node:test';
import assert from 'node:assert/strict';
import { clientDisplayEnvironment } from '../dist/platform/display.js';

test('missing Linux X11 display is an environment failure even when Wayland is present', () => {
  assert.throws(() => clientDisplayEnvironment('linux', {}), /DISPLAY.*No game client/u);
  assert.throws(() => clientDisplayEnvironment('linux', { WAYLAND_DISPLAY: 'wayland-0' }), /DISPLAY/u);
  assert.deepEqual(clientDisplayEnvironment('linux', { DISPLAY: ':99', WAYLAND_DISPLAY: 'wayland-0' }), { platform: 'linux', display: ':99', waylandDisplay: 'wayland-0' });
  assert.deepEqual(clientDisplayEnvironment('win32', {}), { platform: 'win32' });
});
