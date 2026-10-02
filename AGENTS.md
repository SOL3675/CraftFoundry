# CraftFoundry

CraftFoundry is the Minecraft build/validation harness. Its npm package is `craft-foundry`; the compatible CLI remains `mch`. Use Node.js 24 and the root npm lockfile.

- Read `docs/architecture.md`, `docs/distribution.md`, and `docs/repositories.md` for ownership, packaging, and the independent CraftAtlas repository boundary.
- Preserve existing working-tree changes. Keep machine paths, Java homes, EULA state, caches, credentials, and run evidence out of tracked configuration and npm packages.
- Run `npm run check` for harness contract changes and `npm pack` for distribution changes. Verify consumers using the packed package; contract tests do not prove real Minecraft behavior.
- Keep CLI/configuration/report compatibility explicit. Version the package and Skills together; use the Skill installer to preserve consumer edits.
- CraftAtlas is currently a separate checkout. Do not copy it into this repository, create a guessed remote, or replace its independent history. A future submodule has its own package manager and lockfile, not a root npm workspace.
- Remote creation, push, registry publishing, cloud provisioning, and top-level directory moves require task-specific authorization.
