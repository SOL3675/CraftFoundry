# Support and constraints

The configured fixture matrix is deliberately narrow:

| Target | Loader | Build tools | Gradle / compile / game Java |
| --- | --- | --- | --- |
| Fabric 1.21.1 | 0.16.14 | Loom 1.8.13 / Gradle 8.10 | 21 / 21 / 21 |
| NeoForge 1.21.1 | 21.1.252 | ModDevGradle 2.0.148 / Gradle 9.2.1 | 21 / 21 / 21 |
| Fabric 1.20.1 | 0.16.14 | Loom 1.8.13 / Gradle 8.10 | 21 / 17 / 17 |
| Forge 1.20.1 | 47.3.0 | ForgeGradle 6.0.36 / Gradle 8.8 | 17 / 17 / 17 |

Each independent build owns loader-specific registration, mappings, networking, resources, and GameTest launch. Only pure Java logic is shared. Do not infer support for other loader/version combinations or Stonecutter from valid configuration or an upstream catalog.

Each fixture's release profile requires unit, server-gametest, server-smoke, server-persistence, client-smoke, multiplayer, and multi-client. Contract tests use dummy wrappers and backends. Real-game claims require the matching Run, actual distribution hashes, expected case IDs, and evidence from the current environment. Repository configuration alone is not evidence that hosted CI or Xvfb has passed.

The client backend is fixed mc-pilot 0.15.0; dedicated servers are harness-owned. See [backend limitations](backends/mc-pilot.md). Multiplayer reconnect checks do not establish recovery after a complete server restart. Helpers expose loopback control without authentication; keep them isolated. Finite fixture scenarios are not a guarantee for arbitrary Mods.

Use [Linux setup](linux.md) and [CI](ci.md) for prerequisites. Preserve real failed runs separately from successful runs. Unsupported, skipped, unstable, and zero-detected required cases must remain failures. Historical evidence belongs in run artifacts and meaningful commits, not an accumulating repository changelog.

The repository-only [Atlas survival integration](survival.md) accepts these same four exact Minecraft/loader pairs, with version-scoped adapters and definitions. Raw resources, JEI/EMI entries and finite observations preserve provenance; unknown/custom hooks, incomplete coverage and finite samples cannot prove absence, sustainability or progression. Fabric 1.21.1 finite commands remain unsupported; Forge 1.20.1 fluid runtime semantics remain unverified. Atlas PR #6 real-game evidence covers its independently pinned Foundry 0.1.5, not later Foundry candidates.

[Server restart persistence](persistence.md) and [fresh acquisition capture identity](survival.md#fresh-capture-and-built-jar-identity) have cloud process/file/schema contracts. All four supported fixture/collector targets have been compiled and exercised locally with clean restart restoration, deliberate restoration losses, lifecycle cleanup, fresh capture identity and replay rejection. Revalidate affected targets for each new build; cloud contracts alone establish no game pass. Persistence covers one representative mod block/state, stored ItemStack slot and separate custom world data per fixture. Capture identity covers a fresh dedicated harness-owned runtime, its actual loaded mod JAR origins, relevant file inventories and declared JVM properties. Development-directory origins and external/unrecorded dependencies are unverifiable, and integrated-client acquisition identity is not supported by the automatic dedicated capture driver. This does not widen acquisition/observation semantics.
