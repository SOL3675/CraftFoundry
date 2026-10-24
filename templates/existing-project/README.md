# Connect an existing project

Copy these configuration examples into the project and adapt Minecraft/loader build pins, Java roles, existing Gradle tasks and actual JUnit result paths. No Mod source migration is required. First agree AI checks, human checks and untested scope using the [validation plan/result template](../validation/README.md) and [development policy](../../docs/development.md).

The example's `requiredSuites: ["unit"]` is a small automated starting point, not a sufficient release plan for every Mod. Review existing requirements rather than replacing a consumer's configuration wholesale. Add automated suites when the supported features and confirmed plan require them; retain explicitly unsupported drivers for agreed required checks that lack implementation. Optional placeholder suites are not claims of coverage. Record manual review separately; pending human work is not an unsupported machine case.

Export resolved versions/mappings and explicit distribution/runtime JARs to `build/harness/fabric-1.21.1.json`; see [configuration](../../docs/configuration.md). Set `tasks.inspect` to the exporter task when available. Never choose a distribution by a JAR wildcard. Keep build pins distinct from runtime Mod metadata ranges, as explained in the development policy.

Keep Java homes in ignored `harness.local.json`. Run `mch doctor --json` and `mch inspect --target fabric-1.21.1 --json` as planned. Commit shared config, Gradle locks and the pinned harness dependency; exclude `.harness/`, local settings, personal game data and credentials.

For essential affected persistence, connect representative Mod-specific seed/read probes and a dedicated runtime using [the persistence procedure](../../docs/persistence.md), then add `server-persistence` to the agreed requirements. It is a placeholder here, not a mandatory rerun for unrelated changes.

When acquisition analysis is relevant, use the opt-in [acquisition template](../acquisition/README.md) and repository-only [survival workflow](../../docs/survival.md). Select affected mechanisms and positive/missing-prerequisite regressions; unverifiable hooks stay unknown. Required current-build acquisition suites need fresh `captureRuntime` identity rather than an old dump. Absence of Atlas tooling does not universally block ordinary Mod development.
