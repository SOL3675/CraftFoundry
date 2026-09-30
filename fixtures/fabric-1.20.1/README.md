# Fabric 1.20.1 fixture

This independent build root implements the same persisted counter, player-use GUI, block entity and screen property synchronization, and read-only server/client JSON commands as the Fabric 1.21.1 fixture. Dedicated-server regression flags `mch.fixture.breakSync` and `mch.fixture.failStart` remain opt-in and default false.

The build pins Minecraft 1.20.1, Loader 0.16.14, Fabric API 0.92.7+1.20.1, Yarn 1.20.1+build.10, Loom 1.8.13, Gradle 8.10, and JUnit 5.11.4. Gradle runs on Java 21; the toolchain, unit test and game JVMs use Java 17, with `--release 17` output. Configure role keys `java21` and `java17` in ignored local settings and provide the local JDK discovery path to Gradle without putting absolute Java paths in shared files.

Run `gradlew.bat build harnessExport harnessServerGameTest` on Windows or `./gradlew build harnessExport harnessServerGameTest` on Linux. If the caller has accepted the EULA, `MCH_EULA_ACCEPTED=true` reuses that acceptance only in the isolated `build/gametest/eula.txt`; otherwise normal server EULA handling applies. Unit and GameTest XML contain two expected cases each. Target aliases map loader-specific GameTest identifiers to `fixture.counter_initial` and `fixture.counter_persistence`.

The manifest `build/harness/fabric-1.20.1.json` explicitly identifies the remapped distribution and original Fabric API runtime JAR, both sides, resolved loader/mappings, and this root's classpath/source paths. The distribution excludes the separate GameTest source set. The required runtime suites stay unsupported in shared configuration until independently verified runtime settings are connected.

Version references: [Fabric API artifact](https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.92.7+1.20.1/), [Yarn version metadata](https://meta.fabricmc.net/v2/versions/yarn/1.20.1), [Loom metadata](https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml). Gradle wrapper files and their Apache license are copied from the verified canonical v8.10.0 wrapper used by the 1.21.1 fixture; the official distribution SHA256 is enforced in wrapper properties. Fixture source is MIT licensed.
