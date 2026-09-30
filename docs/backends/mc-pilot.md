# mc-pilot client backend

The harness uses **`@kzheart_/mc-pilot` 0.15.0 for clients only**. Fabric, Forge and NeoForge dedicated servers are separate harness-owned runtimes with their own fixed launchers/installers. The mc-pilot server commands do not provide these loader-specific dedicated servers.

## Fixed downloads

| Component | Version / source | SHA-256 |
| --- | --- | --- |
| CLI package | [npm 0.15.0 tarball](https://registry.npmjs.org/@kzheart_/mc-pilot/-/mc-pilot-0.15.0.tgz) | `369ea25fb7a563c97e8b9c1daed01411193579b78a838f5e774900cef8775629` |
| Fabric 1.21.1 helper | [v0.14.0 release artifact](https://github.com/kzheart/mc-pilot/releases/download/v0.14.0/mct-client-mod-fabric-1.21.1.jar), in-game mod version 0.9.1 | `1242ef239b837222fd4eee6f7d957e0e749bde9d47875d62eba14365df5cb749` |
| Fabric 1.20.1 helper | [v0.14.0 release artifact](https://github.com/kzheart/mc-pilot/releases/download/v0.14.0/mct-client-mod-fabric-1.20.1.jar), in-game mod version 0.9.1, game Java 17 | `7c97e1087f9e222513eaa80317fd01245be352be0826c1461061634ee13f9756` |
| Forge 1.20.1 helper | [v0.14.0 release artifact](https://github.com/kzheart/mc-pilot/releases/download/v0.14.0/mct-client-mod-forge-1.20.1.jar), in-game mod version 0.9.1, game Java 17 | `b93ce00ef658a2ac96ae763cbf873772ae912f0ce728a9740b70e3c85ab2bcd9` |
| NeoForge 1.21.1 helper | [v0.14.0 release artifact](https://github.com/kzheart/mc-pilot/releases/download/v0.14.0/mct-client-mod-neoforge-1.21.1.jar), in-game mod version 0.9.1 | `d89bd309af94c0afe6b37dc03f8e9a689b4dabf95ff53f3f04fc7df9a7587788` |
| Inspected upstream source | [commit 87b9da40b203a36a6772fd0464fb50f75e388c06](https://github.com/kzheart/mc-pilot/tree/87b9da40b203a36a6772fd0464fb50f75e388c06) | Source reference; npm published bytes differ |

Install in a tools directory using `--ignore-scripts`. The tested tool installation explicitly overrides dependencies to the inspected upstream lockfile versions: `@xmcl/core` 2.15.1, `@xmcl/installer` 6.1.2, `@xmcl/unzip` 2.1.2, `commander` 14.0.1, `undici` 7.2.3, `ws` 8.19.0, and `pngjs` 7.0.0. Preserve the resulting installation's npm lockfile. Installing only the top-level 0.15.0 pin with unrestricted transitive ranges failed with `EUNSUPPORTEDPROTOCOL` because a newer transitive package contained a `workspace:` dependency. The tested dependency set was reported by npm as having four advisories; this PoC does not certify its dependency security or change versions automatically.

CLI suites require a managed installation made by `mch tools install mc-pilot`. Before launch, `doctor` and the runner verify the installer metadata against the bundled package/lock inputs, helper hash, and every installed backend/dependency file. This read-only check rejects missing metadata, modified executable bytes, unexpected files and redirected package paths; it never repairs or downloads files. The suite report records the verified executable-tree SHA-256 and metadata identity. A package directory carrying only a matching version label does not satisfy the release gate. Direct adapter contract fixtures and the initial research PoCs are separate from this CLI installation contract.

The published CLI's Fabric 1.21.1 catalog points at the removed `v0.9.1` helper release. The inspected source fixes this to a later hosting release, but the npm 0.15.0 tarball does not contain that fix. Supply `helperArtifact: { path, sha256 }` to seed the session's cache with the explicit fixed helper above. The harness verifies the seed before copying it and verifies the deployed helper again. It does not silently substitute a latest helper.

## Ownership and isolation

`McPilotRuntimeAdapter` starts a persistent Node broker. The broker imports the pinned backend APIs, delegates instance creation and normal client launch/stop, and remains alive until cleanup. Each Run has fresh `mct-home`, `mct-cache`, `backend-overlay`, `broker-logs`, and `screenshots` directories. `MCT_HOME` and `MCT_CACHE_DIR` are both set explicitly: setting only `MCT_HOME` does not relocate the upstream default cache. Game instances are below the session home; the personal `.minecraft` directory is unused. The broker fixes the client language to `en_us`, uses an explicit game-Java executable, and keeps the control connection on loopback.

Raw mc-pilot 0.15.0 lifecycle commands are unsuitable as the ownership boundary:

- The npm tarball uses POSIX process utilities and lacks the Windows platform module present in the inspected source.
- `launch` and `stop` can terminate arbitrary processes listening on the selected WebSocket port.
- Persisted instance state uses PID liveness without verifying that a reused PID still identifies an owned process.

The broker creates an **explicit session overlay** of the installed package and replaces `dist/util/process.js` with the ownership policy. `HARNESS-OVERLAY.json` records the source package and every replacement. Installed `node_modules` files remain unchanged. The replacement permits stop requests only for live `ChildProcess` handles captured during this broker invocation; persisted PIDs and port listeners grant no ownership. Arbitrary port cleanup is disabled, and an occupied loopback port produces an error. Client launcher processes stay inside the broker's process group / Windows Job Object. Closing the broker's owning job also removes remaining descendants, including when the launcher exits first. The harness never recovers permission to stop a process from an old PID file or stops all Java processes.

An explicit `downloadConcurrency` from 1 to 16 also replaces the two fixed download-concurrency constants in the session copy of `FabricRuntimeDownloader.js`; unexpected source contracts fail. The fixture drivers use 2 on Linux and retain the upstream 16 on Windows. Linux CDN transfers encountered connection timeouts and truncated assets rejected by their official SHA-1 checks with both sixteen and two concurrent downloads. Individual downloads of the same URLs returned the expected hashes. Runtime dependency preparation permits at most three attempts for reported transient connection errors, with each retry recorded in broker logs. Gameplay actions are never retried. Concurrency changes retain integrity checks and are recorded in the overlay manifest. Aggregate backend errors retain bounded nested error messages and codes so network and checksum failures cannot become empty failure reports.

On Windows, a deeply nested Run can exceed the native DLL loader's path limit even when Java loads the distribution JAR successfully. The broker preloads a harness hook only into its owned client launcher. Before that launcher starts Java, the hook verifies that its native directory resolves inside the fresh `mct-cache`, copies those files into a unique short physical directory below the system temporary directory, and verifies each copy's SHA-256. The Java, LWJGL, JNA and Netty native-directory properties must all identify that same owned source and are redirected together. Classpaths, distribution JARs and the original native cache retain their paths and bytes. Linux does not create these copies or change its arguments.

The session cache retains `.native-aliases` ownership records with an owner token, exact temporary path, source path, and copied-file hashes. After the owning broker process tree stops, including controlled failures and cancellation while the harness remains alive, the adapter verifies the record and temporary-directory marker before deleting the physical copies. Cleanup rejects redirected directories and symbolic links, uses individual file deletion and empty-directory removal, and never deletes the original native directory. The initial short-junction experiment still produced DLL error 206; it remains a failed evidence record. A fresh Java 17 / Fabric 1.20.1 helper-free client then joined successfully with the physical-copy approach: the original native directory was 265 characters long and the temporary directory was 48. All three smoke cases passed, all eight original files retained their recorded hashes, the temporary directory disappeared, and the former server/control ports and launcher process were absent.

An external hard termination of the CLI or its whole process tree can prevent JavaScript cleanup callbacks from running and leave the active session's recorded temporary native copies. Keep the ownership records. After confirming that this session's owning processes and recorded server/control ports have closed, explicit recovery can call `cleanupNativeAliases(cache, record.owner)` from `dist/adapters/runtime/native-paths.js`, using only that known session's exact `mct-cache` and ownership record. The same marker, path and link checks apply. Do not infer permission to terminate a reused PID from the record or sweep other temporary directories. Two externally interrupted validation sessions were recovered this way; their exact copies disappeared and all original native hashes remained unchanged. Earlier verification records retain the pre-recovery state.

`assetCache` can name a read-only `assets/objects` directory from an earlier session. Each object is verified against its SHA-1 filename before writing its bytes into the new isolated cache. Content-addressed indexes in the sibling `assets/indexes` directory are also verified against their SHA-1 filename and parsed asset entries; numeric index aliases are excluded. Fresh official version metadata must select the expected index hash. Version metadata, ready markers, libraries and native binaries are excluded. New Linux metadata and native dependencies still require preparation, and actual game launch/world join remains necessary for a pass. Returned client metadata records object/index counts and bytes used as a seed. This also avoids a pinned `@xmcl/installer` fallback that loses the original asset-index fetch error and destructures an undefined result; that exact fallback failure remains bounded to three installation attempts and retains its diagnostic. The upstream fallback can rewrite valid JSON under its original hash filename, so an existing index may fail the byte hash check. Keep that source unchanged and fetch the official raw index bytes into a separate seed cache, verifying the metadata-selected SHA-1 before use.

## API use

Construct `McPilotRuntimeAdapter` with `backendRoot` pointing at the installed package directory, a fresh `runDir`, a simple `clientName`, `minecraft`, `loader`, an absolute game `java` executable, and a free `wsPort`. Set request, session, and stop deadlines for the project. Optionally provide a session `signal` and a log `redact` callback.

Supply `loaderVersion` to select an exact loader version. The npm catalog's NeoForge 1.21.1 entry specifies 21.1.235; the harness fixture pins 21.1.252. The broker injects the existing `prepareManagedRuntimeImpl` dependency with an in-memory variant containing the exact pin and checks the resulting runtime ID. It records both catalog and resolved loader versions, and does not edit the installed catalog or downloader. Forge/NeoForge installer subprocesses that request a literal `java` are routed to the same explicit game-Java executable within the owned broker, rather than depending on the user's PATH. Actual isolated preparation confirmed `neoforge-21.1.252` with the fixed helper; gameplay support requires separate scenario evidence.

Use this order:

1. `create()` prepares the client and returns instance paths, backend metadata, and the deployed helper SHA-256.
2. `deployMod(path, sha256)` copies an explicit distribution or runtime dependency JAR. Hash mismatches and filename collisions fail.
3. `launch('127.0.0.1:port')` starts the actual client, optionally connecting to a separate dedicated server.
4. `waitReady(timeoutMs)` requires both the control WebSocket and an actual joined world. `waitReady(timeoutMs, false)` confirms only the control bridge and cannot satisfy a world-join test.
5. `control(action, params, timeoutMs)` forwards an explicit mc-pilot protocol action and rejects responses whose inner `success` is false. `screenshot('name.png')` saves a PNG under the Run screenshot directory, with one attempt rather than hidden retry.
6. Always `await stop()` in `finally`. A request deadline or session cancellation disposes the owning broker and its descendants; failed cleanup remains a failure.

`control` exposes the backend protocol, not a promise that every action is supported on every Minecraft/loader combination. Tests must assert state and expected case IDs separately; a launched process or connected WebSocket cannot satisfy a required suite. Store client metadata, deployed JAR hashes, the broker logs, and the client log below `mct-home/logs` with the Run's evidence. Remove secrets from evidence before retention or distribution.

For the helper-free distribution smoke, use `launchWithoutHelper(server)`. It verifies and removes only the session's known helper JAR before launch. It uses the same real Minecraft client launcher, distribution Mod, and required runtime dependencies. Without the helper there is no control WebSocket; the independent dedicated-server log confirms the actual player join, and the client loaded-Mod log confirms that `mct` was absent. Stop still uses the broker's live ownership handles.

`runClientSmoke` and `runFixtureMultiplayer` in `src/adapters/test/multiplayer.ts` provide the tested product drivers. The multiplayer scenario requires the fixture Mod's read-only `/fixture state` and `/fixture_client state` observations. Its verified registry covers Minecraft 1.20.1/1.21.1 with Fabric 0.16.14, Minecraft 1.20.1 with Forge 47.3.0, and Minecraft 1.21.1 with explicitly pinned NeoForge 21.1.252. Other versions remain unsupported rather than inferred from the upstream catalog. It checks terrain/HUD readiness in addition to world presence, places the block through `block.place`, uses it through `block.interact`, compares independent server/entity/GUI values, captures the GUI, saves the world, reconnects, and compares values again. Setup may teleport the player and give its inventory; the tested placement and state changes never use `setblock` or a counter mutation command. There are no automatic action retries.

`runFixtureMultiClient` (or `runFixtureMultiplayer` with `clients: 2`) additionally prepares `MchPeer` in its own home, cache, broker job, and control port. Both players receive the same hashed distribution, runtime dependencies, and helper. `MchTest` performs the placement and GUI interaction; `MchPeer` independently reads the block entity without opening a GUI. The peer then reconnects, the independent server log must show a new join, and both clients must still observe value 1. All client jobs are disposed in reverse order before the server, including failure and cancellation. The default remains one client and retains the existing `multiplayer.*` IDs. The two-client driver emits seven `multi-client.*` IDs.

## Validation evidence (2026-09-30)

| Check | Result |
| --- | --- |
| TypeScript compilation and adapter ownership/protocol contracts | Passed, including cancellation, exact loader pins, and installer Java selection |
| Real Minecraft 1.21.1 / Fabric 0.16.14 / Java 21 client preparation | Passed |
| Fixed helper 0.9.1 loaded by the real client | Passed |
| Loopback WebSocket readiness with world check disabled | Passed |
| Real `status.all` query | Passed; reported the Minecraft loading screen and `inWorld: false` |
| Real PNG capture | Passed; visually inspected 854×480 Mojang loading-screen image |
| Client stop and subsequent WebSocket port check | Passed; connection refused after cleanup |
| Real helper-free distribution client connected and joined the dedicated server | Passed; fixture and Fabric API loaded, `mct` absent |
| Player placed fixture block and server/client initial state was zero | Passed |
| Player used fixture block and opened its real `CounterScreen` GUI | Passed |
| Independent server counter, client block-entity counter, GUI counter | Passed; all equal to 1 |
| Real GUI screenshot | Passed; visually inspected `Counter: 1` |
| World save and reconnect, with server/client state retained | Passed; value remained 1 after reconnect |
| Product drivers: three client-smoke and six multiplayer cases | Passed with real games |
| Two real clients: placement, GUI, independent peer state, peer reconnect, cleanup | Passed; seven cases, same fixture/helper hashes, peer entity value 1 and no GUI |
| Two-client intentional broken sync and cancellation after both joined | Failed/cancelled scenarios retained; both client jobs and server cleaned up, all three ports refused connections |
| NeoForge 21.1.252: helper-free client, placement, GUI/server/entity synchronization, reconnect, two clients | Passed; three smoke, six multiplayer and seven multi-client cases; visual GUI `Counter: 1`; all former server/control ports refused connections |
| Linux / WSLg, Fabric 1.21.1 with portable Node 24 and Java 21 | Passed; all sixteen real-game cases, visual GUI `Counter: 1`, all seven former server/control ports refused connections |
| Windows, Fabric 1.20.1 / loader 0.16.14 / game Java 17 | Passed; all sixteen real-game client, GUI synchronization, peer and reconnect cases |
| Linux / WSLg, NeoForge 1.21.1 / loader 21.1.252 / portable Java 21 | Passed; all sixteen real-game cases across two isolated runs, independent peer value and reconnect value 1, all former ports refused connections |
| Linux / WSLg, Fabric 1.20.1 / loader 0.16.14 / portable Java 17 | Passed; all sixteen real-game cases, server/entity/GUI and peer reconnect value 1, all former ports refused connections |
| Windows, Forge 1.20.1 / loader 47.3.0 / game Java 17 | Passed; all sixteen real-game cases, independent cleanup checks found zero remaining client PIDs and open ports |
| Injected `mch.fixture.breakSync=true` with the same distribution JAR | Correctly failed `multiplayer.sync`; server value 1, client entity and GUI values 0; dependent reconnect skipped; cleanup passed |
| Injected `mch.fixture.failStart=true` | Correctly rejected readiness as an infrastructure error; gameplay cases skipped; cleanup passed |
| World recovery after a full server restart | Not established by this multiplayer reconnect scenario |
| Linux Forge and other Minecraft/loader versions | No direct game evidence recorded here yet; full CLI matrix validation is tracked separately |

The adapter tests use explicitly dummy backend modules to verify protocol handling, cleanup, occupied ports, hash checks, and refusal to stop unrelated PIDs. Those tests are not real-game passes. Upstream catalog entries such as `validation: verified` are source metadata and do not promote a combination into this harness's verified support list.

The first multiplayer development attempt failed because its target cell was one block above the default flat terrain. Its action trace, screenshots, and logs were retained separately. The corrected scenario uses ground support at Y=-61, places the fixture at Y=-60, and waits for a playable HUD and grounded position. Both the corrected direct PoC and the product driver passed as fresh isolated runs; the earlier failure was not converted into a successful retry.

The startup-negative experiment also confirmed that the Fabric server launcher may return process exit code zero after a Mod initialization exception. Readiness and suite assertions are therefore mandatory; process exit zero alone cannot mark startup successful. Negative experiments retain their failure state and screenshot rather than retrying until success. Their server/control ports were checked after cleanup and no longer accepted connections.

Linux NeoForge and legacy Fabric sessions used unique owned ext4 `/tmp` roots while SDKs and sources remained in the workspace. Each session recorded an ownership token, stopped its server and client jobs, checked the released ports, archived logs/screenshots/world evidence into `.harness/linux-ext4-game`, and removed only its exact owned temporary root. Earlier mounted-filesystem preparation timeouts, asset-index network failures and rejected rewritten index bytes remain separate failed records. The completed scenarios used verified immutable object/index seeds and freshly prepared Linux native libraries; no game action was retried. See [the evidence index](mc-pilot-evidence.json) for individual results.

The four fixed helper JARs were individually SHA-256 checked and their actual `MctWebSocketServer` bytecode inspected. Each constructs `InetSocketAddress("127.0.0.1", port)`, so the control bridge binds only to loopback. The configurable setting is `MCT_CLIENT_WS_PORT`; these fixed helpers expose no authentication token capability. This check used the locked artifacts, not a claim based on the current upstream branch.
