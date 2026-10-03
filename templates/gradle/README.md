# Export Gradle artifacts

Copy `harness-export.gradle` into the build, configure `ext.harnessExportSpec`, and apply the script. It adds `harnessExport` and writes `build/harness/<target>.json`. Keep the project's Wrapper and actual dependency resolution.

Use [Fabric](../../fixtures/example-mod/build.gradle) or [NeoForge](../../fixtures/neoforge-1.21.1/build.gradle) as an example.

| Field | Meaning |
| --- | --- |
| `target`, `loader`, `java` | Target ID, loader, compilation Java major |
| `declaredMinecraft` | Declared version, checked against resolution |
| `artifactTasks` | Tasks producing explicit artifacts |
| `resolved` | Closure returning actual minecraft, loaderVersion, mappings |
| `artifacts` | Closure returning file/kind/side maps |
| `classpath` | Closure returning inspection files |
| `sources` | Source directories within the project |

Fabric uses remapJar, Forge the reobfuscated JAR, and this NeoForge build uses jar. List runtime dependencies separately with their placement side. Do not choose the first file in build/libs or deploy test-only Mods.

Artifacts must be regular files within the build root. Kinds are distribution/runtime-dependency/sources/development and sides client/server/both. At least one distribution is required. Inspection classpaths may reference external Gradle cache paths but do not authorize runtime deployment.

Set `tasks.inspect: ["harnessExport"]` and `artifactManifest: "build/harness/<target>.json"` in shared configuration. The CLI validates schema, identity, containment, and hashes; see [configuration](../../docs/configuration.md).
