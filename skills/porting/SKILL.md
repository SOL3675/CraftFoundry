---
name: porting
description: Port a Minecraft mod between explicitly configured loader/version targets using craft-foundry without weakening required tests.
---

Inspect source and destination targets separately with `mch inspect --target <id> --json`. Do not copy a new version's API into an older target without checking its resolved sources and mappings.

Share pure Java logic and common Minecraft behavior where practical. Isolate registration, events, networking and loader-specific APIs. Keep incompatible Gradle toolchains in independent build roots. Serialize source-switching tools such as Stonecutter within one working tree; parallel work needs separate copies.

Preserve common test case IDs and assertions across targets. Missing test APIs or driver capabilities remain explicit unsupported results, rather than simulated passes. Validate the changed target and representative compatibility boundaries. Shared networking, resources, adapters or release candidates require all affected targets and their distribution JAR tests.

For acquisition changes on Fabric/NeoForge 1.21.1, compare fresh Atlas captures for each loader using `atlas datapack`, `inspect` and `diff` as described in `templates/acquisition/README.md`. Check effective resources, source pack IDs, override stacks and RecipeManager registration after reload; a raw-resource diff alone does not prove changed execution. Re-review loader-specific conditions, machine power and custom APIs before adapting exact-version definitions. Preserve provenance, positive and `without` prerequisite cases, and unresolved unknowns. Custom-directory raw data cannot close coverage. Do not extend Atlas survival support to other Minecraft versions during a port.
