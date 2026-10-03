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

## Use

The package is unpublished and remains `private: true`, `UNLICENSED`. See [distribution and development](docs/distribution.md) for local packages and the independent [CraftAtlas repository](https://github.com/SOL3675/CraftAtlas). No registry publication is required.

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

See [tools](docs/tools.md), [Skills](docs/skills.md), [Linux setup](docs/linux.md), [CI](docs/ci.md), and [support constraints](docs/support.md). Fixture licenses and Gradle notices remain with their files; making this repository public does not grant a license for the unlicensed harness.
