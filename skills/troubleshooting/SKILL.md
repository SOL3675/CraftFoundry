---
name: troubleshooting
description: Diagnose craft-foundry build and game validation failures using structured reports, logs and recorded artifact identities.
---

Read `mch report --run <run-id> --json` and the referenced evidence before changing code. Distinguish a failed assertion from infrastructure errors, unsupported drivers, cancellation, timeouts and zero discovered tests.

For an environment failure, run `mch doctor --json` and check each Java role, wrapper, display environment, configured tool hash and EULA state. For an API/build failure, inspect the selected target's resolved sources and dependencies. For a distribution failure, verify recorded JAR hashes and side placement; compare the helper-free smoke test with detailed tests that include an operation helper.

Preserve the first failed attempt. Reproduction requires the matching revision, working-tree changes and fixed dependencies; the replay command alone does not restore dirty source. Never kill all Java processes or trust a stale PID as ownership. Investigate an ambiguous persistent build lock before removing it.
