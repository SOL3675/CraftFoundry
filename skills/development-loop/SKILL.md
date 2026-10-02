---
name: development-loop
description: Build and validate a Minecraft mod through craft-foundry and inspect version-specific evidence after code changes.
---

Select a target with `mch targets --json`. Inspect its actual resolved classpath, source paths and mappings using `mch inspect --target <id> --json` before using Minecraft APIs. Prefer those sources when current documentation differs from the target version.

After implementing a change, run `mch build --target <id> --json`, followed by the affected `mch test --target <id> --suite <id> --json`. Runtime tests deploy the recorded distribution JAR and dependencies rather than arbitrary files in `build/libs`.

Use `mch report --run <run-id> --json` to inspect case statuses, detection counts, artifact hashes and failure evidence. Do not accept an exit code alone as proof of tests. Report unsupported, skipped, zero-detected and unstable retry results accurately. Before a release, execute `mch test --all --profile release --json` with every required suite.
