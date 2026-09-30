/** The pinned Minecraft clients use GLFW's X11 backend on Linux. */
export function clientDisplayEnvironment(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): { platform: string; display?: string; waylandDisplay?: string } {
  if (platform === 'linux' && !env.DISPLAY?.trim()) throw new Error('Linux real-client suites require an X11 DISPLAY (WSLg or Xvfb). No game client was launched; prepare the display environment first.');
  return { platform, ...(env.DISPLAY ? { display: env.DISPLAY } : {}), ...(env.WAYLAND_DISPLAY ? { waylandDisplay: env.WAYLAND_DISPLAY } : {}) };
}
