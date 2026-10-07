# Connect an existing project

Copy these configuration examples into the project and adapt Minecraft/loader pins, Java role names, existing Gradle tasks, and actual JUnit result paths. No Mod source migration is required.

Export resolved versions/mappings and explicit distribution/runtime JARs to `build/harness/fabric-1.21.1.json`; see [configuration](../../docs/configuration.md). Set `tasks.inspect` to the exporter task when one is available. Never select a distribution by a JAR wildcard.

Keep Java homes in ignored `harness.local.json`. Run `mch doctor --json` and `mch inspect --target fabric-1.21.1 --json`. Leave required unimplemented suites explicitly unsupported until connected to a real driver. Commit shared config, Gradle dependency locks, and the pinned harness dependency; exclude `.harness/`, local settings, personal game data, and credentials.

When the Mod adds custom item acquisition, use the [acquisition authoring template](../acquisition/README.md) and [survival workflow](../../docs/survival.md). Include explicit extension/coverage checks and positive/missing-prerequisite regressions in development; leave unverifiable hooks unknown.

The template requires `server-persistence` as unsupported until you implement representative Mod-specific seed/read probes and a dedicated runtime using [the persistence procedure](../../docs/persistence.md). Required acquisition suites should use fresh `captureRuntime` identity rather than a saved dump; see [capture identity](../../docs/survival.md#fresh-capture-and-built-jar-identity).
