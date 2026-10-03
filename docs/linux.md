# Linux setup

Use Node.js 24, npm, Git, and the JDK roles needed by the chosen target (17 and/or 21). Keep OS-specific dependencies in the fixture's `gradle/linux.lockfile`; Windows uses `gradle.lockfile`.

```console
npm ci --ignore-scripts
npm run check
node dist/cli/main.js targets --json
node dist/cli/main.js doctor --json
```

Set Linux absolute Java homes in ignored `harness.local.json`; Windows paths cannot be reused. The adapter invokes `gradlew` through `/bin/sh`, including archives that do not preserve its executable bit. An explicit `GRADLE_USER_HOME` is respected; otherwise caches stay under the project. For direct manual Gradle commands use `sh gradlew` when executable mode is absent.

Real clients require X11 `DISPLAY` with working OpenGL, audio/native libraries, fonts, and the pinned backend. WSLg and Xvfb are separate display environments. A nonempty DISPLAY or successful dummy test does not establish rendering. Record `glxinfo -B` when available, game logs, screenshots, and required case results. See [CI](ci.md) for an Xvfb setup.

Download retries are bounded and logged; game actions/assertions are not retried to hide failures. Verified asset objects/indexes may seed fresh sessions, but native libraries and prepared markers must match the current OS and remain isolated. On mounted Windows filesystems, game setup can be I/O-sensitive; use an explicitly owned Linux working directory when appropriate and preserve evidence before cleanup.

Do not delete an ambiguous stale build lock or kill unrelated Java processes. The harness owns its child process groups and loopback ports; interrupted sessions require ownership verification before recovery. See [backend recovery](backends/mc-pilot.md).
