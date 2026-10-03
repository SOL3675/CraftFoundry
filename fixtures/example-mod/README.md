# Harness fixture

This is the Fabric 1.21.1 integration fixture, built with Java 21. It registers `fixture:counter`, a diamond-textured block whose persistent counter increases when a player uses it. Use opens a screen displaying the server counter through synchronized screen properties. Block entity update packets also synchronize the value to other clients watching the chunk. The operator-only `fixture state <x> <y> <z>` command reads the server value without changing it.

Server observations print `MCH_FIXTURE_SERVER {"counter":N}`. The local `/fixture_client state <x> <y> <z>` command prints `MCH_FIXTURE_CLIENT {"counter":N,"guiCounter":N,"screen":"counter"}` to client chat. The command only reads local block entity and screen handler state; it does not send a command to the server. A missing counter or unopened counter screen yields `null` for the corresponding value. `screen` is `counter`, `none`, or `other` depending on the current visible screen.

The distribution JAR contains the fixture and client screen. A separate development source set supplies two server GameTests; its classes and entrypoint are excluded from the distribution.

The fixture has two opt-in regression controls for verifying harness failures with real game processes. Add these JVM arguments before the server's `-jar` argument in a separate test configuration:

- `-Dmch.fixture.breakSync=true` keeps server counter increments and persisted NBT intact but disables block entity update packets, sends zero in initial chunk counter data, and holds the GUI property at zero. The normal player scenario must fail its client/server value assertions.
- `-Dmch.fixture.failStart=true` throws `MCH_FIXTURE_INTENTIONAL_START_FAILURE` during dedicated server initialization, before fixture registration. The runtime must report the startup failure and preserve the actual process logs.

Both flags apply only in Fabric's dedicated server environment and default to false. They are absent from the shared normal configuration. These controls supply faults; their presence alone is not evidence that a harness detected them. Preserve the real failing scenario report and logs separately from successful runs.

Pinned dependencies:

| Component | Version | Source |
| --- | --- | --- |
| Minecraft | 1.21.1 | [Fabric version metadata](https://meta.fabricmc.net/v2/versions/game) |
| Fabric Loader | 0.16.14 | [Fabric Loader Maven](https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.14/) |
| Fabric API | 0.116.6+1.21.1 | [Fabric API Maven POM](https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.116.6+1.21.1/fabric-api-0.116.6+1.21.1.pom) |
| Yarn | 1.21.1+build.3 | [Version-specific mappings metadata](https://meta.fabricmc.net/v2/versions/yarn/1.21.1) |
| Fabric Loom | 1.8.13 | [Loom Maven metadata](https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml) |
| Gradle | 8.10 | [Distribution SHA256](https://services.gradle.org/distributions/gradle-8.10-bin.zip.sha256), [wrapper SHA256](https://services.gradle.org/distributions/gradle-8.10-wrapper.jar.sha256) |
| JUnit Jupiter | 5.11.4 | [JUnit Maven](https://repo.maven.apache.org/maven2/org/junit/jupiter/junit-jupiter/5.11.4/) |

The Gradle wrapper JAR and scripts are the canonical Gradle v8.10.0 wrapper; the JAR was verified against the official SHA256 `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`. The distribution hash is enforced by `gradle-wrapper.properties`. Gradle wrapper code is Apache-2.0 licensed; fixture source is MIT licensed.

Set local Java roles in `harness.local.json` and use a project-local `GRADLE_USER_HOME`. Run `gradlew.bat build harnessExport` on Windows or `./gradlew build harnessExport` on Linux. The export identifies the remapped distribution and original Fabric API runtime JAR explicitly. Sources/classpath data is scoped to this target.

`gradlew.bat harnessServerGameTest` starts a real headless Minecraft GameTest server in `build/gametest`, with XML at `build/test-results/gametest/results.xml`. The caller must provide its already-accepted EULA there; the build does not accept the EULA automatically. Unit tests write normal Gradle JUnit XML under `build/test-results/test`.

The shared configuration connects all six required suites. Run `mch tools install mc-pilot --project . --json`, then set its returned backend/tool paths plus Java home and already-accepted EULA in ignored `harness.local.json`. `mch test --all --profile release --json` builds the explicit distribution and runs unit, real server GameTest, helper-free server/client smoke, and the actual multiplayer scenario. NBT GameTest round-trip coverage is separate from the multiplayer scenario's reconnect and server save.
