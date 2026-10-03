# Connect an existing project

Copy these configuration examples into the project and adapt Minecraft/loader pins, Java role names, existing Gradle tasks, and actual JUnit result paths. No Mod source migration is required.

Export resolved versions/mappings and explicit distribution/runtime JARs to `build/harness/fabric-1.21.1.json`; see [configuration](../../docs/configuration.md). Set `tasks.inspect` to the exporter task when one is available. Never select a distribution by a JAR wildcard.

Keep Java homes in ignored `harness.local.json`. Run `mch doctor --json` and `mch inspect --target fabric-1.21.1 --json`. Leave required unimplemented suites explicitly unsupported until connected to a real driver. Commit shared config, Gradle dependency locks, and the pinned harness dependency; exclude `.harness/`, local settings, personal game data, and credentials.
