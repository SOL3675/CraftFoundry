# Support and constraints

The configured fixture matrix is deliberately narrow:

| Target | Loader | Build tools | Compile/game Java |
| --- | --- | --- | --- |
| Fabric 1.21.1 | 0.16.14 | Loom 1.8.13 / Gradle 8.10 | 21 |
| NeoForge 1.21.1 | 21.1.252 | ModDevGradle 2.0.148 / Gradle 9.2.1 | 21 |
| Fabric 1.20.1 | 0.16.14 | Loom 1.8.13 / Gradle 8.10 | 17 |
| Forge 1.20.1 | 47.3.0 | ForgeGradle 6.0.36 / Gradle 8.8 | 17 |

Each independent build owns loader-specific registration, mappings, networking, resources, and GameTest launch. Only pure Java logic is shared. Do not infer support for other loader/version combinations or Stonecutter from valid configuration or an upstream catalog.

Each fixture's release profile requires unit, server-gametest, server-smoke, client-smoke, multiplayer, and multi-client. Contract tests use dummy wrappers and backends. Real-game claims require the matching Run, actual distribution hashes, expected case IDs, and evidence from the current environment. Repository configuration alone is not evidence that hosted CI or Xvfb has passed.

The client backend is fixed mc-pilot 0.15.0; dedicated servers are harness-owned. See [backend limitations](backends/mc-pilot.md). Multiplayer reconnect checks do not establish recovery after a complete server restart. Helpers expose loopback control without authentication; keep them isolated. Finite fixture scenarios are not a guarantee for arbitrary Mods.

Use [Linux setup](linux.md) and [CI](ci.md) for prerequisites. Preserve real failed runs separately from successful runs. Unsupported, skipped, unstable, and zero-detected required cases must remain failures. Historical evidence belongs in run artifacts and meaningful commits, not an accumulating repository changelog.
