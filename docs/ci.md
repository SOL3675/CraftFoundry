# Continuous integration

[Contract CI](../.github/workflows/contracts.yml) runs npm clean install, typecheck, tests, and pack on Windows and Ubuntu with Node 24.19.0. It uploads package and run artifacts. Keep the workflow's npm version aligned with consumer package generation.

[Fixture CI](../.github/workflows/fixtures.yml) is a manually dispatched real-game workflow. It accepts a target (or all) and explicit existing EULA acceptance, defaulting to false. Only select true when the user has already accepted Minecraft's EULA and authorizes its reuse in CI. Setup failure does not count as a game pass.

The workflow pins Actions by commit, Node, Temurin Java 17/21, and the mc-pilot tool lock. Ubuntu runner images and apt packages remain mutable. It prepares Xvfb at 1280×720×24 with Mesa, audio/X11 libraries, and fonts, records `glxinfo -B`, then runs doctor and the required release suites in that display environment. Preserve actual environment metadata when evaluating reproducibility.

`configure-fixtures.mjs` validates tool hashes and writes ignored local configuration without overwriting existing local settings. Gradle, npm, backend downloads, and game sessions stay under the workspace's `.harness/`. It does not modify shared EULA state or Java configuration.

Evidence collection and upload use `always()`, including incomplete reports after cancellation. `.harness/ci/evidence/` keeps reports, JUnit, logs, redacted source identities, referenced screenshots, crash reports, explicit Mod artifacts, and configuration diagnostics, preserving Run-relative paths. Game caches, full worlds, backend node_modules, and unrelated files are excluded. Artifacts expire after 14 days; export required release evidence before expiry.

To adapt the packaged workflow to another project, see [the CI template](../templates/ci/README.md). Executable configuration and contract tests do not prove a hosted real-game run passed. Run all required suites before making a release claim.
