# CraftFoundry

[日本語](README.ja.md)

CraftFoundry is a Minecraft Java Edition build and validation harness for developers, agents, and CI. The npm package is `craft-foundry`; its CLI is `mch`. It uses each project's Gradle Wrapper and records explicit artifacts, test results, and evidence.

## Develop

Use Node.js 24 (CI: 24.19.0) and npm (package generation: 11.9.0). From this repository:

```console
npm ci --ignore-scripts
npm run check
npm pack
node dist/cli/main.js --help
```

`npm run check` checks TypeScript and harness contracts. These tests use dummy runtimes and do not establish real Minecraft support. Generated `dist/`, tarballs, and `.harness/` are ignored.

CraftAtlas is an independent pinned submodule at `projects/craft-atlas`. The repository-only [survival acquisition suite](docs/survival.md) uses its real data/analysis APIs, with reproducible offline cases and explicit unknown external sources. Initialize the submodule, then run `npm run check:atlas` and `npm run test:atlas`. Current common scope: Fabric/NeoForge Minecraft 1.21.1.

## Use

The package is unpublished and remains `private: true`. See [distribution and development](docs/distribution.md) for local packages and the independent [CraftAtlas repository](https://github.com/SOL3675/CraftAtlas). No registry publication is required.

Connect a Gradle project using [configuration](docs/configuration.md), the [existing-project example](templates/existing-project/README.md), or the [multiloader example](templates/multiloader/README.md). Configure machine-specific Java homes and tools in ignored `harness.local.json`.

```console
mch doctor --json
mch targets --json
mch inspect --target fabric-1.21.1 --json
mch build --target fabric-1.21.1 --json
mch test --target fabric-1.21.1 --suite unit --json
mch test --all --profile release --json
mch report --run <run-id> --json
```

Reports and JUnit output live in `.harness/runs/<run-id>/`. Exit codes are 0 for success, 1 for failed validation, and 2 for configuration or environment errors. JSON mode emits one object to stdout and progress to stderr. Required unsupported, skipped, or zero-detected tests cannot pass a release gate.

See [tools](docs/tools.md), [Skills](docs/skills.md), [Linux setup](docs/linux.md), [CI](docs/ci.md), and [support constraints](docs/support.md).

## Per-Mod acquisition definitions

Use the [acquisition definition template](templates/acquisition/README.md) to describe version-scoped per-Mod definitions and regression cases for custom serializers, machines, and other ways to obtain items. The [survival development checks](docs/survival.md#per-mod-acquisition-definitions-and-development-checks) explicitly report unsupported or undeclared mechanisms and missing inputs. Normal validation and Windows/Ubuntu CI use the pinned Atlas without a local source override. Use `--atlas-source` for explicit local validation of upcoming Atlas changes. Java hook semantics are not inferred and remain unknown.

## License

Original CraftFoundry code and documentation are licensed under [MIT](LICENSE), copyright (c) 2026 SOL3675. Files with separate license or copyright notices retain those terms and notices, including the fixture MIT licenses and Gradle Wrapper's Apache-2.0 headers and bundled notices. Dependencies, downloaded tools, Minecraft, and other Mods retain their own licenses. The npm package includes LICENSE and the existing fixture/Gradle notices; fixture binary and source JARs include their existing MIT license in `META-INF/LICENSE`.
