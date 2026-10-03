# forge-1.20.1 fixture

This independent Gradle build uses Forge 47.3.0, ForgeGradle 6.0.36, Gradle 8.8, Java 17. It shares the pure Java [counter logic](../common/README.md) and follows the [counter fixture behavior](../example-mod/README.md). Loader registration, networking, resources, and GameTests remain local to this root. See `gradle.properties`, `build.gradle`, and the Wrapper properties for exact build pins and hashes.

From this directory, use `gradlew.bat` on Windows or `sh gradlew` on Linux:

```console
sh gradlew --no-daemon --console=plain build harnessExport harnessUnit harnessServerGameTest
```

Set the matching JAVA_HOME and an explicit GRADLE_USER_HOME first. GameTests require an already accepted EULA in the isolated game directory, or `MCH_EULA_ACCEPTED=true` when the user has already accepted it. Harness users instead configure Java roles and consent in ignored `harness.local.json` at their selected project root.

`harnessUnit` and `harnessServerGameTest` each require two cases. The exporter selects an explicit production JAR (after reobfuscation on Forge), excludes test-only source sets, and includes a source snapshot for inspection. Target caseAliases map actual GameTest IDs to the shared contract. Use the root release profile for server/client/multiplayer tests, which require the pinned backend and helpers.

The server `/fixture state x y z` and client `/fixture_client state x y z` observe state without changing it. Forge's player relay requests an independent client observation rather than reporting server state as a client value. Intentional breakSync/failStart controls are separate negative tests and do not belong in normal release configuration.

Fixture source keeps its [license](LICENSE); Gradle Wrapper notices remain in [gradle/LICENSE-Gradle.txt](gradle/LICENSE-Gradle.txt). Declared pins and build scripts do not prove a current environment has passed real-game tests.
