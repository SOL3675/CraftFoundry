# Bundled skill installation

The package includes `project-setup`, `development-loop`, `porting`, and `troubleshooting`. Install them into an explicit skill directory using the harness skill installer. Run `mch skills install --destination <directory> --json`; it returns the package version and relative file lists named `installed`, `updated`, and `preserved`.

Installation records provenance in the destination's `.mch-skills.json`: schema version, bundle version, and each managed file's SHA256 and installed version. Future installations replace a managed file only if its current hash still matches the recorded hash. Files edited by the user and existing files without provenance are preserved. Their original records remain unchanged; an unrecorded file stays unmanaged. Files removed from a later bundle are retained.

The installer handles supporting references and scripts along with `SKILL.md`. Missing files are installed, including a previously managed file that the user removed. Repeating an installation of unchanged managed files produces empty change lists. Upgrading identical content updates its provenance version without rewriting the file.

To adopt a new bundled version after editing a skill, save your customization elsewhere and remove the destination copy, then reinstall. Review `preserved` paths before choosing this action. Installation never removes a user customization automatically.

Metadata is validated before skill files are changed and replaced atomically. Destination links and linked skill subdirectories/files are rejected. A `.mch-skills.lock` prevents overlapping installers. If an interrupted installation leaves this lock, inspect the destination and confirm the previous installer has ended before removing the lock. Interrupted file updates whose provenance was not committed will be preserved on the next installation.

The skill bundle version follows the harness package version. Keep the harness, schemas, documentation, and bundled skills on the same pinned package version. The API supports an explicit source root and version for isolated upgrade tests; ordinary installations use the installed package's bundle.

The 0.1.8 bundle covers exact Forge/Fabric 1.20.1 and NeoForge/Fabric 1.21.1 acquisition workflows, target Java roles and singular/plural resource paths. Finite observations, raw NBT/network provenance and viewer records retain partial/unknown boundaries. Install the new package's Skills over an existing managed installation; untouched files upgrade to 0.1.8 while user-edited files retain their original content and recorded hash/version. Review preserved customizations against the new target guidance. The package ships the acquisition authoring template and docs; it still does not ship the repository-only Atlas runner or submodule.

The 0.1.8 setup/development/porting Skills require representative clean-process restart persistence and current-build fresh acquisition identity on supported targets, preserving unsupported/never-run coverage when probes or collectors are unavailable.
