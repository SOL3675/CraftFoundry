# CraftFoundry

[日本語](README.ja.md)

CraftFoundry builds and validates Minecraft Java Edition Mods through one CLI for developers, agents and CI. Its npm package is `craft-foundry`; the CLI is `mch`. It uses your project's Gradle Wrapper and records distribution hashes, test results and evidence.

## Install and connect a project

Use Node.js 24. The package is unpublished and `private: true`; install an exact local tarball following [distribution and updates](docs/distribution.md). Connect existing Gradle tasks and explicit artifact paths using [configuration](docs/configuration.md), [existing-project](templates/existing-project/README.md) or [multiloader](templates/multiloader/README.md). Keep Minecraft, loader and dependencies pinned in Gradle, and machine Java homes/tools/EULA state in ignored `harness.local.json`.

| Target | Gradle / compile / game Java |
| --- | --- |
| NeoForge 1.21.1 | 21 / 21 / 21 |
| Fabric 1.21.1 | 21 / 21 / 21 |
| Forge 1.20.1 | 17 / 17 / 17 |
| Fabric 1.20.1 | 21 / 17 / 17 |

These are the configured fixture targets; see [support and constraints](docs/support.md) for exact pins and validation limits. Other combinations are not inferred.

```console
mch doctor --json
mch targets --json
mch inspect --target fabric-1.21.1 --json
mch build --target fabric-1.21.1 --json
mch test --target fabric-1.21.1 --suite unit --json
mch test --all --profile release --json
mch report --run <run-id> --json
```

Reports and JUnit are saved under `.harness/runs/<run-id>/`. Exit codes are success `0`, validation failure `1`, and configuration/environment error `2`. JSON mode emits one stdout object and progress to stderr. Required unsupported, skipped, unstable or zero-detected cases cannot pass a release gate.

Install bundled agent Skills with `mch skills install --destination .agents/skills --json`; the installer preserves user edits. Install the fixed client backend with `mch tools install mc-pilot --project <directory> --json` and configure its returned path locally. See [Skills](docs/skills.md), [tools](docs/tools.md), [Linux](docs/linux.md) and [CI](docs/ci.md).

Use [server restart persistence](docs/persistence.md) to verify representative saved block entities/state, inventory and custom world data in a second dedicated process on the same disposable world. Required suites keep missing probes explicit.

## Review acquisition changes

The [acquisition template](templates/acquisition/README.md) helps review custom serializers, machines and other item sources against current [CraftAtlas](https://github.com/SOL3675/CraftAtlas) captures. The repository-only [survival suite](docs/survival.md) supports NeoForge/Fabric 1.21.1 and Forge/Fabric 1.20.1; the npm package ships guidance and templates, while the runner requires the Foundry repository and its pinned Atlas submodule.

Required acquisition checks use [fresh capture identity](docs/survival.md#fresh-capture-and-built-jar-identity) to bind runtime JARs/configuration to the current built Run; old or unverifiable captures cannot pass.

Review effective datapack JSON, source pack IDs, byte hashes and override stacks before writing exact-version definitions. Use `recipe` paths for 1.21.1 and `recipes` for 1.20.1. Raw data, JEI/EMI display entries and finite loot/block/entity/world observations are evidence, not proof of execution, exhaustive absence, sustainable supply or progression. Unknown hooks and incomplete coverage remain unknown/unsupported; Forge fluid runtime behavior remains unverified.

Harness source development, test fixtures and package production are documented in [development and distribution](docs/distribution.md).

## License


Original CraftFoundry code and documentation are licensed under [MIT](LICENSE), copyright (c) 2026 SOL3675. Files with separate license or copyright notices retain those terms and notices, including the fixture MIT licenses and Gradle Wrapper's Apache-2.0 headers and bundled notices. Dependencies, downloaded tools, Minecraft, and other Mods retain their own licenses. The npm package includes LICENSE and the existing fixture/Gradle notices; fixture binary and source JARs include their existing MIT license in `META-INF/LICENSE`.
