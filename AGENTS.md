# CraftFoundry

CraftFoundry is the Minecraft build/validation harness. Its npm package is `craft-foundry`; the compatible CLI remains `mch`. Use Node.js 24 and the root npm lockfile.

- Read `docs/configuration.md`, `docs/distribution.md`, and `docs/support.md` for ownership, packaging, and the independent CraftAtlas repository boundary.
- Preserve existing working-tree changes. Keep machine paths, Java homes, EULA state, caches, credentials, and run evidence out of tracked configuration and npm packages.
- Run `npm run check` for harness contract changes and `npm pack` for distribution changes. Verify consumers using the packed package; contract tests do not prove real Minecraft behavior.
- Keep CLI/configuration/report compatibility explicit. Version the package and Skills together; use the Skill installer to preserve consumer edits.
- CraftAtlas is an independent Git submodule at `projects/craft-atlas`, with its own package manager and lockfile, not a root npm workspace. Pin reachable reviewed commits; never copy a sibling checkout or replace its history. Root install/build/pack must not recurse into Atlas. Run `npm run check:atlas` and `npm run test:atlas` for the repository-only acquisition integration; see `docs/survival.md`.
- Remote creation, push, registry publishing, cloud provisioning, and top-level directory moves require task-specific authorization.

- Keep root README and procedural documentation in English, with a linked README.ja.md. Record change rationale in commits, not standalone design restatements or migration/change logs.
