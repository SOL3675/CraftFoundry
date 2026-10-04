---
name: project-setup
description: Connect an existing Minecraft Java mod project to craft-foundry using its Gradle Wrapper and explicit target/artifact mappings.
---

Read the installed harness `docs/configuration.md` and schema when preparing a project. Keep Minecraft, loader, mappings and plugin versions authoritative in Gradle. Define only explicitly supported targets; do not infer support from a version range.

Map the project's existing Gradle tasks in `harness.config.json` and export an artifact manifest identifying the distribution JAR, runtime dependencies and placement side. Keep Java homes and EULA acceptance in ignored `harness.local.json`; distinguish Gradle, compilation and game Java. Pin downloaded tools by version and SHA256 in `harness.lock.json`.

Run `mch doctor --json`, then `mch inspect --target <id> --json`. Treat missing prerequisites as environment diagnostics, not a mod regression. Declare required suites based on the mod's supported side and features. Keep unimplemented required suites explicit; they must prevent a release pass.


During setup, inventory custom acquisition mechanisms (including mechanisms outside recipe serialization). For Mods adding custom acquisition on supported Fabric/NeoForge 1.21.1 targets, declare the repository-only Atlas survival process suite as required, and use `templates/acquisition/README.md` to declare per-Mod definitions, mechanisms and positive/missing-prerequisite regression cases. Preserve an explicit unsupported suite when current capture/definitions or access are unavailable. A valid config or provider seed alone is not acquisition coverage. Upgrade consumer Skills using the installer, preserving edited files.

Plan a fresh active-server capture with `datapack.json` and matching RecipeManager data after build/reload. Inventory separate server JSON directories and, when needed, set `-Dcraftatlas.resourceDirectories=machines,yourmod/acquisition` on the game JVM; paths are below `data/<namespace>/`. Follow the acquisition template's actual `atlas datapack`/`inspect` commands to review effective resources, override stacks, byte hashes and pack IDs before authoring definitions. Raw capture is independent of viewers, excludes disabled-pack contents/client assets, and does not prove custom semantics or closed coverage. Source-only or runtime-only paths need explicit execution review; unavailable evidence stays unknown.
