# Configuration

Place `harness.config.json` at the project root, or select one with `mch --project <directory>`. Configuration and result schemas use version 1; unknown versions/fields/references and Minecraft versions below 1.20.1 are rejected. A valid declaration does not prove support: see [constraints](support.md).

| File | Purpose | Commit? |
| --- | --- | --- |
| `harness.config.json` | Builds, targets, suites, runtimes | Yes |
| `harness.lock.json` | Fixed tool versions, HTTPS URLs, SHA-256 | Yes |
| `harness.local.json` | Absolute Java/tool/backend paths, deadlines, EULA state | No |
| `.harness/` | Isolated runs, evidence, caches, locks | No |

Missing local configuration defaults to schemaVersion 1; a missing tool lock defaults to an empty tools map. Malformed existing files fail. Local settings cannot override required suites or targets. The complete field definitions are in [config](../schemas/harness.config.schema.json), [local](../schemas/harness.local.schema.json), [tool lock](../schemas/harness.lock.schema.json), [artifact](../schemas/artifact-manifest.schema.json), and [run](../schemas/run.schema.json) schemas.

## Connect Gradle

Adapt the following example's tasks and result paths to the actual project. The unsupported client suite is intentional and blocks release until a real driver is connected.

```json
{
  "schemaVersion": 1,
  "projectId": "example-mod",
  "builds": {
    "main": { "root": ".", "adapter": "gradle", "java": "jdk21" }
  },
  "targets": {
    "fabric-1.21.1": {
      "minecraft": "1.21.1",
      "loader": "fabric",
      "build": "main",
      "tasks": {
        "inspect": ["harnessExport"],
        "build": ["build"],
        "unit": ["test"],
        "serverGameTest": ["runGameTest"]
      },
      "artifactManifest": "build/harness/fabric-1.21.1.json",
      "requiredSuites": ["unit", "server-gametest", "client-smoke"],
      "java": { "gradle": "jdk21", "toolchain": 21, "game": "jdk21" }
    }
  },
  "suites": {
    "unit": {
      "driver": "gradle",
      "task": "unit",
      "results": "build/test-results/test/TEST-example.CounterStateTest.xml",
      "minTests": 1
    },
    "server-gametest": {
      "driver": "gradle",
      "task": "serverGameTest",
      "results": "build/gametest-results.xml",
      "expectedTests": ["fixture.counterPersists"],
      "minTests": 1
    },
    "client-smoke": {
      "driver": "unsupported",
      "requiredCapabilities": ["real-client"]
    }
  },
  "runtimes": {}
}
```

`target.build` selects a build root. `target.tasks` maps logical keys to arrays of actual Gradle tasks; `suite.task` selects a key, not a raw task or Gradle option. The local Wrapper runs with `--no-daemon --console=plain`. Operations sharing a build root are serialized. Confirm the recorded owner has ended before recovering a stale `.harness/build-adapter.lock`.

Build runs the `build` mapping, then `inspect` if configured. A declared inspect task must generate a fresh manifest. Without an inspect task, an explicitly provided manifest may be used. Pin Minecraft, loader, mappings, and dependencies in Gradle. Manifest target/Minecraft/loader and an optional declared loaderVersion must match. `caseAliases` maps loader-specific test IDs to common IDs; duplicates and missing IDs still fail. `suiteBindings` selects target-specific runtime/pilot connections while preserving common case requirements.

Use [the Gradle exporter](../templates/gradle/README.md). Preserve an explicit `GRADLE_USER_HOME`; otherwise the harness uses `.harness/cache/gradle/`. Linux fixtures use `gradle/linux.lockfile`, Windows fixtures use `gradle.lockfile`, because native dependencies differ.

## Artifact manifest

`artifactManifest` is relative to the build root. Specify exact files, never a first-match JAR glob.

```json
{
  "schemaVersion": 1,
  "target": "fabric-1.21.1",
  "minecraft": "1.21.1",
  "loader": "fabric",
  "loaderVersion": "0.16.14",
  "mappings": "yarn:1.21.1+build.3",
  "java": { "gradle": "jdk21", "toolchain": 21, "game": "jdk21" },
  "artifacts": [
    { "path": "build/libs/example-mod.jar", "kind": "distribution", "side": "both" },
    { "path": "build/libs/example-mod-sources.jar", "kind": "sources", "side": "both" }
  ]
}
```

Kinds are `distribution`, `runtime-dependency`, `sources`, and `development`; sides are `client`, `server`, and `both`. At least one distribution is required. Sources/development/javadoc JARs cannot serve as distributions. Files are saved with size and SHA-256 under the Run; changed build output requires rebuilding before capture.

Project-owned paths accept the supplied root spelling and its canonical real path, including Windows 8.3 aliases. Existing parents must still resolve inside that canonical root; an escaping symlink or junction is rejected before creating or reading managed files.

Build roots and deployed artifacts must stay within their declared roots: absolute paths, parent traversal, reserved Windows names, and escaping symlinks are rejected. Build root `.` is allowed. Optional inspection classpath/source metadata may describe external paths, but does not authorize deployment of those files.

## Suites and results

Gradle suites read one result file relative to the build root; process suites read one relative to their isolated session. Globs and directory aggregation are unsupported. Old results are removed before execution; only fresh result snapshots are evaluated. A minimal JSON result is:

```json
{
  "schemaVersion": 1,
  "cases": [
    { "id": "fixture.counterPersists", "status": "passed", "durationMs": 20 }
  ]
}
```

Statuses distinguish passed, failed, unsupported, skipped, and infrastructure-error. JUnit IDs use `classname.name` when a classname exists, otherwise name. DOCTYPE is rejected. Every expected ID must be detected and at least one test is required (`minTests` can raise that number). Missing/duplicate IDs, required skipped/unsupported tests, and zero detections fail. An earlier failed attempt followed by a pass remains unstable and cannot become a release pass.

`mch test --target <id> --suite <id>` runs a selected suite. Without a suite it runs required suites. `--all --profile release` runs all required suites and refuses a suite filter. Empty requirements do not establish release validation. Required capabilities must match the runtime. Gradle provides `gradle-task` and `test-results`.

## External processes

Add this fragment to shared configuration and supply the actual test script:

```json
{
  "suites": {
    "external-test": {
      "driver": "process",
      "runtime": "external",
      "results": "results.json",
      "expectedTests": ["fixture.external"],
      "requiredCapabilities": ["fixture-observation"]
    }
  },
  "runtimes": {
    "external": {
      "kind": "server",
      "capabilities": ["fixture-observation"],
      "command": {
        "executable": "node",
        "args": ["{projectRoot}/scripts/external-test.mjs", "{sessionRoot}/results.json", "{target}"]
      }
    }
  }
}
```

Use an executable plus an argument array. `{projectRoot}`, `{sessionRoot}`, `{runRoot}`, and `{target}` are substituted; child processes also receive `MCH_PROJECT_ROOT`, `MCH_SESSION_ROOT`, and `MCH_TARGET`. Session cwd is `.harness/runs/<run-id>/sessions/<target>/<suite>/`. A generic process exit is not proof of game readiness or gameplay.

For a persistent dedicated server use `server-smoke`, which waits for readiness, sends `stop`, and verifies shutdown. It produces `server.ready` and `server.stopped` without a results file:

```json
{
  "suites": {
    "server-smoke": {
      "driver": "server-smoke",
      "runtime": "dedicated-server",
      "requiredCapabilities": ["dedicated-server"],
      "expectedTests": ["server.ready", "server.stopped"],
      "minTests": 2
    }
  },
  "runtimes": {
    "dedicated-server": {
      "kind": "server",
      "capabilities": ["dedicated-server"],
      "command": {
        "executable": "{java:game}",
        "args": ["-Xmx2G", "-jar", "{tool:fabric-server}", "nogui"]
      },
      "readyPattern": "Done \\("
    }
  }
}
```

Add the suite to requiredSuites. `{java:game}` selects the target's game Java, `{tool:<key>}` a SHA-256-verified locked tool. These server command placeholders occupy whole arguments. `{sessionRoot}`, `{port}`, and `{os}` (`win`/`unix`) are available. Forge/NeoForge setup runs in the isolated session before the command. Server sessions use loopback, unique ports, and an isolated test world; offline authentication is for local validation only.

Tool locks require an exact version and 64-digit SHA-256; mutable `latest` is rejected. `local.tools` may point to matching bytes, otherwise the HTTPS lock URL is fetched. Downloads have a 512 MiB limit and never silently reuse invalid bytes. See [tools](tools.md).

## Java, display, consent, and timeouts

```json
{
  "schemaVersion": 1,
  "java": {
    "jdk17": "C:\\Java\\jdk-17",
    "jdk21": "C:\\Java\\jdk-21"
  },
  "timeouts": { "build": 600000, "start": 120000, "test": 120000, "stop": 5000 },
  "eulaAccepted": false
}
```

Replace example homes with actual absolute paths, such as `/opt/jdk-21` on Linux. The target's Gradle Java overrides the build role; toolchain declares compilation requirements, while game Java controls launch. Local homes are passed to Gradle toolchain discovery without changing the project's toolchain settings.

Set `eulaAccepted: true` only after the user has accepted Minecraft's EULA. Suites declaring `eulaRequired` and game runtimes require it. Direct fixture Gradle tasks need an already-accepted isolated `eula.txt` or `MCH_EULA_ACCEPTED=true`. Keep personal `.minecraft` data separate. Linux clients require X11 `DISPLAY`; a Wayland variable alone is insufficient.

Timeouts are positive milliseconds. Build defaults to 600 seconds, Gradle/process tests to 120 seconds, and process stop grace to 5 seconds. Server smoke defaults to 120-second readiness, a 300-second session, and 10-second shutdown grace. Missing Java roles are reported by doctor/adapters rather than invented.

Optional `assetCache` is an absolute `assets/objects` directory. `assetCaches` maps Minecraft versions to such directories and takes precedence. Objects and adjacent content-addressed indexes are verified against SHA-1 names before reuse; native libraries, prepared markers, personal settings, and worlds are never reused. Rewritten index JSON must be replaced with separately obtained official bytes, not accepted under an invalid hash.

## Evidence

Reports and JUnit live under `.harness/runs/<run-id>/`; evidence paths are relative to that Run. Exit codes are 0/1/2 for success/validation failure/environment error. JSON mode writes one stdout object and progress to stderr.

With Foundry 0.1.7 or later, process-suite JSON cases may include `detail: { "file": "results.json.evidence.json", "pointer": "/details/0" }` and versioned survival diagnostic counts, as described in [survival diagnostics](survival.md#diagnostic-summaries-and-complete-details). Input detail paths are relative to the results file; retained report paths are relative to the Run. Companions must be regular JSON files inside the Run with resolvable RFC 6901 pointers. Missing files, unresolved pointers, unknown survival evidence versions and inconsistent counts fail inspection/retention. Preserve `suite.evidence` files with the report for portable CLI/JUnit/CI inspection. Full driver messages remain in JSON; JUnit abbreviates human text over 1,800 UTF-16 units and references the full detail/message. Ordinary results/reports without these optional fields remain compatible.

Reports record config/tool/artifact hashes, resolved metadata, case results, Git revision, and source identity. Tracked dirty changes have a redacted patch and hash; untracked files have path/hash identities but no saved contents. Credentials are redacted and local Java/EULA state is not copied into shared configuration. Replay cannot restore missing dirty sources or local prerequisites: inspect `reproduction.limitations`.
