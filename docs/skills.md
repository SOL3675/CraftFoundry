# Bundled skill installation

The 0.1.12 package includes `project-setup`, `development-loop`, `porting`, `troubleshooting` and `minecraft-development-basics`. Install into an explicit directory with `mch skills install --destination <directory> --json`. The result contains the package version and relative lists `installed`, `updated` and `preserved`.

Installation records provenance in `.mch-skills.json`: schema version, bundle version and each managed file's SHA-256/installed version. Updates replace a managed file only while its current hash matches the recorded hash. User-edited and existing unrecorded files are preserved; original records remain unchanged and unrecorded files stay unmanaged. Files removed from a newer bundle are retained.

Supporting references/scripts are installed alongside `SKILL.md`. Missing files are installed, including previously managed files the user removed. Reinstallation is idempotent. Identical managed content can receive updated version provenance without rewriting the file. A newly bundled Skill is installed without overwriting customized existing Skills.

Review `preserved` files against the new guidance. To adopt a bundled file over a customization, save the customization elsewhere and remove that destination copy before reinstalling, only after choosing that replacement. The installer never removes customization automatically. An edited old Skill may therefore need a human-reviewed merge of the new workflow; installing a package alone does not silently adopt all policy changes.

Metadata is validated before writes and replaced atomically. Destination links and linked subdirectories/files are rejected. `.mch-skills.lock` prevents overlapping installers; confirm a previous installer has ended before recovering a stale lock. Interrupted file updates without committed provenance are preserved on the next installation.

Bundle version follows the package version. Keep package, schemas, docs and Skills aligned, while retaining existing schema versions when their contracts do not change. The installer API's source/version overrides support isolated upgrade tests; ordinary installations use the installed package bundle.

## Development guidance

The four workflow Skills link to [Minecraft development basics](../skills/minecraft-development-basics/SKILL.md). It prefers native container/menu and screen inheritance for inventory manipulation, with version-scoped examples, server authority and explicit remaining slot/transfer/close responsibilities. It also covers logical sides, registration/IDs, resources and per-instance persistence separately from synchronization.

[Development policy](development.md) and the [plan/result template](../templates/validation/README.md) require human confirmation of AI checks, human checks and untested scope before implementation. AI mainly checks feature functionality/build/logic and essential affected persistence. Detailed GUI interactions, play feel and balance default to humans. Human-pending is separate from machine failure; it does not trigger exhaustive automation. Plans/results use ordinary prose/tables without a new CLI or result-status schema.

Persistence and acquisition guidance is selected by impact, rather than an unconditional requirement for every Mod edit. Once a current-build acquisition or restart check is agreed as required, its actual identity/evidence/assertion rules still apply. Exact Forge/Fabric 1.20.1 and NeoForge/Fabric 1.21.1 adapters retain their partial/unknown boundaries. The npm package includes templates/docs, not the repository-only Atlas runner/submodule. Harness [storage safety](storage.md) remains intact and does not impose product restrictions.

Add reusable lessons iteratively with applicability, reason, exception and minimum check. Avoid blanket rules from one-off bugs and automatic publication or consumer deployment.
