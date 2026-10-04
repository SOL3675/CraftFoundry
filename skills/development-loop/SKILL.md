---
name: development-loop
description: Build and validate a Minecraft mod through craft-foundry and inspect version-specific evidence after code changes.
---

Select a target with `mch targets --json`. Inspect its actual resolved classpath, source paths and mappings using `mch inspect --target <id> --json` before using Minecraft APIs. Prefer those sources when current documentation differs from the target version.

After implementing a change, run `mch build --target <id> --json`, followed by the affected `mch test --target <id> --suite <id> --json`. Runtime tests deploy the recorded distribution JAR and dependencies rather than arbitrary files in `build/libs`.

Use `mch report --run <run-id> --json` to inspect case statuses, detection counts, artifact hashes and failure evidence. Do not accept an exit code alone as proof of tests. Report unsupported, skipped, zero-detected and unstable retry results accurately. Before a release, execute `mch test --all --profile release --json` with every required suite.


When a change adds or alters crafting, a custom serializer/machine, drops, harvesting, world generation, trades or a Java acquisition hook, explicitly inspect the current Atlas capture and the affected item selection. For Fabric/NeoForge 1.21.1 use the repository-only `docs/survival.md` and `templates/acquisition/README.md`; an installed npm package alone does not supply the Atlas runner. Review whether a built-in normalizer covers the mechanism. Add/update a version-scoped, evidence-backed DefinitionPack and a `mechanisms` entry when custom semantics are needed, or retain an `unknown` reason for unverifiable hooks. Do not turn ingredient-consuming processes into provider/inventory seeds.

Add/update positive and missing-prerequisite regression cases (`without`), then run the affected survival process suite and inspect definition hashes, original/effective coverage, development diagnostics and detected case IDs in its evidence. Run `npm run check:atlas`, `npm run test:atlas` and `npm run test:atlas:definitions` in the Foundry repository when changing this integration. For a reviewed local Atlas commit not yet published/pinned, the latter accepts `-- --atlas-source <checkout>`. Unsupported serializers, absent mappings/tests, invalid definitions and incomplete acquisition coverage must remain explicit failures/unsupported; never guess arbitrary code semantics or claim a real-game pass from offline checks.
