---
name: porting
description: Port a Minecraft mod between explicitly configured loader/version targets using craft-foundry without weakening required tests.
---

Inspect source and destination targets separately with `mch inspect --target <id> --json`. Do not copy a new version's API into an older target without checking its resolved sources and mappings.

Share pure Java logic and common Minecraft behavior where practical. Isolate registration, events, networking and loader-specific APIs. Keep incompatible Gradle toolchains in independent build roots. Serialize source-switching tools such as Stonecutter within one working tree; parallel work needs separate copies.

Preserve common test case IDs and assertions across targets. Missing test APIs or driver capabilities remain explicit unsupported results, rather than simulated passes. Validate the changed target and representative compatibility boundaries. Shared networking, resources, adapters or release candidates require all affected targets and their distribution JAR tests.
