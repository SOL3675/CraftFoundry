# Validate multiple targets

Copy these two JSON files to a project root containing `fixtures/` and `templates/` in the package's relative layout. The root package configuration is equivalent. Each fixture has an independent Gradle build and shares pure Java logic from `fixtures/common`.

Common suites specify expected case IDs and counts. Target `caseAliases` translate real loader-specific IDs; `suiteBindings` connect target runtimes and helpers. Set local `java17`/`java21` homes, backend paths, deadlines, and existing EULA acceptance in ignored `harness.local.json`. See [configuration](../../docs/configuration.md) and [tools](../../docs/tools.md).

```console
mch doctor --json
mch inspect --target fabric-1.21.1 --json
mch test --target fabric-1.21.1 --suite unit --json
mch test --all --profile release --json
```

Change the target argument for other fixtures. Required unsupported/missing tests block release. Fixture multiplayer drivers require the counter block, GUI, and observation commands; adapt actual tasks, artifacts, results, and scenarios when connecting a new Mod. See [support constraints](../../docs/support.md).
