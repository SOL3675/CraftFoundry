# Storage management

Use `mch storage` to inspect a project's `.harness` data before changing its storage policy. Storage settings live in ignored `harness.local.json`; they do not belong in shared configuration or a package. All defaults preserve existing behavior. Foundry 0.1.10 does not adopt or delete historical unmarked caches.

```console
mch storage --project <directory> --json
mch storage --project <directory> --clean --json
mch storage --project <directory> --clean --unit <uuid> --json
mch storage --project <directory> --clean --unit <uuid> --apply --json
```

The first command inventories storage. `--clean` produces a cleanup preview; deletion requires `--apply` as well. `--unit` selects a `unitId` from the inventory, restricts cleanup to that unit and is valid only with `--clean`. `--apply` is also valid only with `--clean`. Review the machine-readable candidates and retained paths with their reasons before applying. Cleanup rechecks its safety conditions when applying; a preview does not reserve its targets or authorize another project.

## Separate dependencies from retained data

Enable future managed client dependency caches explicitly:

```json
{
  "schemaVersion": 1,
  "storage": {
    "managedCaches": true,
    "sharedAssets": true,
    "cleanup": "retain"
  }
}
```

`managedCaches` and `sharedAssets` default to `false`; `cleanup` defaults to `"retain"`. Asset reuse can be enabled independently. Both `"after-run"` and `"after-suite"` require `managedCaches: true`. Managed client dependency caches use `.harness/c/<uuid>/mct-cache` instead of placing the dependency cache inside the Run. Ownership and completion metadata distinguish these units from older client directories. Turning the setting on does not migrate existing data.

The following data stays retained:

| Data | Policy |
| --- | --- |
| Run reports, JUnit, results, logs, screenshots and captured evidence | Retain; finalize and hash-check evidence before dependency cleanup |
| Worlds, runtime settings, `mct-home`, deployed Mods and `.native-aliases` | Retain; never treat these as reclaimable dependency caches |
| Existing unmarked `.harness/c`, `.harness/runs` and other caches | Retain; no automatic adoption |
| Active leases, open restart reservations, ambiguous ownership or incomplete evidence | Retain with a reason |
| External paths and links/junctions | Exclude; never traverse a link to reclaim its destination |
| Eligible new managed client dependency cache | Preview first; reclaim only with explicit apply or an opt-in automatic policy |

Cleanup is limited to `.harness/c/<uuid>/mct-cache/client`, the managed client dependency subtree. The unit's `unitId` is a separate ownership identity. Cleanup does not delete an entire Run, client home, world or generic Gradle cache. Required reproduction inputs and evidence remain part of the Run. Failed results keep their original status and evidence; reclaiming a disposable dependency cache cannot turn them into a pass.

## Share verified assets

`sharedAssets: true` enables reuse through `.harness/cache/shared-assets/<minecraft-version>` of content-addressed Minecraft `assets/objects/<prefix>/<sha1>` and `assets/indexes/<sha1>.json`. Version scopes avoid seeding unrelated versions into every session. SHA-1 must match the content-addressed name on import, reuse and session materialization. The harness attempts copy-on-write clones and falls back to regular independent copies where cloning is unsupported. It does not use writable hard links to connect a game session to shared data. Every session can therefore write its own files without changing another session's asset bytes.

Only immutable, revalidated asset bytes qualify. Objects are bounded at 128 MiB, indexes at 16 MiB, and index references and scanned asset counts at 100,000. Prepared markers, extracted native libraries, runtime dependencies outside this asset contract, worlds, settings and run evidence are not shared. An invalid hash is an error, never a reason to weaken verification. Shared assets can outlive an individual managed client cache; cleanup does not infer that a shared object is unused. Independent publishers use exclusive temporary files and atomic publication so one session cannot overwrite another publisher's object.

Copy-on-write support depends on the operating system and filesystem. A successful clone request can still fall back to a full copy on Windows/NTFS. Logical byte counts may count identical or cloned files more than once and do not describe allocated physical bytes, free space or guaranteed reclaimable capacity. Compare free-space measurements separately when evaluating a candidate.

Directly sharing game-visible asset files is deferred. The current implementation always materializes independent session files through clones or copies; it does not use writable hard links between the cache and game sessions. On a filesystem that falls back to copies, the shared cache can reduce downloads while adding its own retained bytes, without reducing session allocation.

## Completion and cleanup safety

| Local `storage.cleanup` | Reclamation point |
| --- | --- |
| `"retain"` (default) | Explicit reviewed cleanup only |
| `"after-run"` | Eligible newly managed caches after the finished Run and full evidence verification |
| `"after-suite"` | Eligible newly managed caches after a suite stops, saves immutable scoped evidence, links it in the saved report and closes its reservation; may run before the next suite |

The existing runtime `cleanup: true` option continues to control owned process shutdown; it is not a disk-retention setting. Changing the local policy does not authorize historical data cleanup.

A unit becomes eligible only after its owners have positively confirmed shutdown and its required evidence has been saved and verified. Uncertain ownership, an interrupted save, missing or changed proof, a live lease, an open reservation, a linked path or a path outside the managed root keeps the unit retained. Cleanup uses ownership coordination and validates paths again when applying. A crash or forced termination can leave a retained unit; do not edit its ownership/proof metadata merely to make it eligible. Investigate it and preserve evidence before any separately authorized manual action.

Built-in drivers first await owned client/server disposal, then retain logs, crash evidence and the cleanup trace. They publish completion only after that entire phase succeeds, including server evidence collection. With `after-suite`, the runner links immutable scoped seals in the report, saves the report, closes the reservation and applies selected cleanup before continuing to the next suite. `after-run` continues to wait for the finished report and JUnit. A gameplay assertion failure may still have complete evidence; a stop, evidence-save, report-save, seal or reservation-close failure does not authorize reclamation.

Unit records contain the cache path, owner-token hash, PID and a random owner process-instance identity, lifecycle state, cache file metadata and evidence proof. Exclusive path claims prevent duplicate owners. Completion requires the original process instance and token, so PID reuse or a persisted old token cannot recover active ownership. Once completed, a later cleanup invocation may validate that proof without recovering live process ownership.

Reservations protect the whole period in which a runtime may reuse a cache. Each process phase acquires a lease and releases it only after confirmed shutdown and evidence sealing. A restart gap with no live lease still remains protected by the open reservation. Closing requires at least one lease, every lease released and the relevant immutable seals linked from the saved Run report. Closing does not infer process death. An open reservation or abandoned lease after a crash remains retained.

Inventory explains these protections with reasons such as `open-reservation`, `active-or-unconfirmed-lease` and `scoped-evidence-changed-or-incomplete`. Report or seal tampering is a retention/error condition, not a cue to regenerate proof from changed files.

Scoped seals hash only explicit regular files belonging to one target/suite/optional phase. The report stores their `{ schemaVersion: 1, id, file, sha256 }` references in top-level `storageEvidence`; report save/read revalidate them and their files. The Run report may continue changing as later suites execute, while an earlier seal and its evidence stay immutable. Later report updates must preserve earlier references. This enables mid-Run cleanup without hashing a mutable whole Run into an early completion proof.

Each seal is `storage-seals/<uuid>.json` relative to the Run. Its version-1 manifest records Run identity, target/suite/optional phase, seal time and explicit file paths with SHA-256 and size. Membership must contain 1–100,000 regular, singly linked files; manifests are limited to 16 MiB. Use forward-slash Run-relative paths. Directories, symlinks/junctions, hard-linked inputs, mutable `report.json`/`junit.xml`, temporary/partial/lock files, hidden path components and other seals cannot be members. Scope labels organize proof; they do not establish that the caller selected complete evidence or prove gameplay assertions. Preserve every required input and observation before sealing.

Seals persist content identity using the relative path, SHA-256 and size. Validation checks device/inode, link count and timestamps while reading to detect concurrent replacement, but does not require the original inode afterward: a stable copy with identical bytes remains portable when restored under `.harness/runs/<run-id>`. A seal is not an OS permission boundary or a signature establishing who produced the evidence.

Complete, close and flush owned evidence writers before sealing. Report/JUnit files, seal manifests and retained dependency copies use explicit file flushes; directory flushes are attempted where Node and the filesystem support them. These barriers and fail-closed process-crash handling do not establish full power-loss durability, particularly where Windows cannot flush directory handles. Missing, changed or incomplete proof after an interruption remains an error and cannot authorize reclamation.

`retainClientDependencyMetadata(projectRoot, cacheDir, runRoot)` copies available JSON metadata from the stopped managed cache's `client/runtime/<version>/versions/` and direct `assets/indexes/` into a fresh `storage-dependencies/<uuid>/` subtree in the Run, returning Run-relative paths to include in the seal. It retains at most 256 files, 16 MiB per file and 64 MiB total, with a selected-subtree depth limit of 16. JARs, asset objects, worlds, settings, native extraction directories and hidden markers are excluded. Missing metadata directories are allowed; the returned files preserve what was available and do not attest a complete installation or trustworthy upstream provenance. Installer-created JSON index hardlinks may be read through verified read-only handles, checking their stable identity and hashes, then copied into independent singly linked retained files. This narrow copy operation never modifies or shares the source files with a game session; seal inputs themselves still require one link.

The JSON inventory uses `schemaVersion: 1`, `sizeKind: "logical"`, `totalBytes`, `reclaimableBytes`, `retainedBytes`, `availableBytes` and `entries`. `availableBytes` is a separate filesystem free-space observation, or `null` if unavailable. Each entry includes `path`, `kind`, `logicalBytes`, `disposition` (`retain`, `reclaim` or `deleted`), `reason` and, when known, `unitId`. Cleanup also returns `apply`, `deletedBytes`, `errors` and an `auditPath` for applied operations. Ownership records are under `.harness/storage/units/`; applied operations write `.harness/storage/audits/<uuid>.json` before deletion and update it with outcomes. Preserve this output with the reviewed operation.

Durable audits add `auditSchemaVersion: 1` and `entryScope: "selected-managed-units"`. Their `entries` list the selected units; `retainedScope` records the exact complement under `.harness` using `exceptCacheRoots`, with observed retained logical bytes and entry count. This keeps unrelated historical file lists out of each new audit. CLI inventory and cleanup responses still include the full observed file list.

Partial deletion or an I/O error remains visible; rerunning cleanup must re-evaluate the remaining unit rather than assuming the previous attempt succeeded. Disk exhaustion or an incomplete evidence save does not qualify the unit for automatic reclamation. An interrupted cleanup can leave `.harness/storage/cleanup.lock`; verify the recorded owner has ended and inspect the audit before recovering that lock. A stale PID alone is not sufficient ownership evidence.

The legacy full-Run API still hashes the full retained Run without following overlay links; large Runs can require repeated reads and sizable manifests. The reservation/lease path validates immutable scoped seals and avoids requiring a finished whole Run for each suite. Inventory sizes are observations while other runs may still be writing; they are estimates rather than a filesystem snapshot. Keep adequate free space for evidence and audit writes before opting in. Disk-full behavior is covered through fail-closed write boundaries; filling a real disk is not part of the contract tests.

## Runtime integration API

Consumers owning a custom test runtime import lifecycle functions from `craft-foundry/core/storage`. For mid-Run reclamation, keep this order:

1. Call `createStorageReservation(projectRoot, cacheRoot)` for a new, nonexistent `.harness/c/<uuid>/mct-cache/client` and retain the returned reservation handle in its owning process. Existing directories cannot be adopted. The cache directory UUID and reservation `id` are separate identities.
2. Before every process phase using the cache, call `acquireStorageLease(projectRoot, reservation)`. Keep the reservation open across intentional restarts; acquire a new lease for each subsequent phase.
3. Positively confirm that every process using that lease has stopped. Save all required results, logs, images, raw captures, manifests and reproduction inputs inside the Run. For a managed mc-pilot cache, call `retainClientDependencyMetadata(projectRoot, cacheDir, runRoot)` and include its returned paths with the other required files before sealing. Do not derive `stopped: true` from PID absence, a stale lock, a timeout or an attempted stop.
4. Call `createStorageEvidenceSeal(projectRoot, runRoot, { scope: { target, suite, phase }, files })`, where `files` are paths relative to the Run and `phase` is optional. Select complete retained evidence for that scope; a seal cannot substitute for omitted evidence. `validateStorageEvidenceSeal(runRoot, ref)` checks an existing reference.
5. Call `attachStorageEvidence(projectRoot, runRoot, [seal])` to durably append the reference to the ongoing report before releasing ownership. This function is also exported by `craft-foundry/core/storage`; custom drivers do not need a separate reporting import. Attachment and report saves coordinate under the same Run report lock, preserving already attached references across stale in-memory checkpoints.
6. Call `releaseStorageLease(projectRoot, lease, { stopped: true, evidenceRoot: runRoot, seal })` with the returned seal reference. Keep the reservation open when another phase will reuse the cache, and acquire another lease before restarting. A released lease does not close the reservation.
7. Call `closeStorageReservation(projectRoot, reservation)` only after its final use, with every lease released and its seal linked from the saved report. Closing is idempotent and requires at least one lease. Then run selected, authorized cleanup; an unfinished Run is permitted on this scoped-evidence path. An external process driver can complete this sequence and reclaim its cache before exiting, allowing the parent to continue the Run.

Failed assertions can still have complete retained evidence; failed shutdown cannot satisfy this contract. The API supplies neither missing evidence nor process ownership recovery. Keep an uncertain reservation/lease active rather than attesting completion.

The compatible `createStorageUnit(projectRoot, cacheRoot)` and `finalizeStorageUnit(projectRoot, handle, { stopped: true, evidenceRoot: runRoot })` path remains available for full-Run finalization. It requires confirmed shutdown, the same original owning process/token, finished report/JUnit and a verified full Run snapshot. It does not provide mid-Run reclamation or restart reservations.

The common `.harness/storage/cleanup.lock` coordinates lifecycle mutations and cleanup. Contention fails without changing ownership; retry after the other operation completes. There is no automatic stale-PID recovery. Managed roots must not be repurposed or written by external processes after shutdown. Applying a preview rebuilds the candidate list and revalidates ownership, evidence, links and cache metadata before deletion; every file's type, size and modification identity is checked again immediately before unlinking. Shared assets are outside every eligible subtree and are never garbage-collected, including while other runs reference them. Native locks or partial I/O failures retain the remaining files and are reported for a fresh retry.

`inventoryStorage(projectRoot)` returns the inventory above. `cleanupStorage(projectRoot)` previews; `cleanupStorage(projectRoot, { apply: true, unitIds: [id] })` applies an authorized selection after revalidation. The public API does not infer or stop custom runtime processes and does not supply missing evidence. Prefer leaving a unit active over attesting uncertain completion.

## Upgrade and recovery

Install the exact reviewed `craft-foundry-0.1.10.tgz`, keeping its integrity in the consumer lockfile, then update bundled Skills with `mch skills install --destination .agents/skills --json`. Review the installer's `preserved` customizations. Configuration and reports remain schema version 1; reports containing `storageEvidence` require a 0.1.10-or-later reader. Reports without that optional field and the existing `after-run` policy remain compatible. Start with inventory and a dry-run, and opt in through local configuration for subsequent Runs. Custom drivers using mid-Run cleanup must implement reservations, leases and report-linked scoped seals before selecting `after-suite`. A candidate package does not authorize clearing historical user data.

Reclaimed dependencies are restored by normal preparation from valid local sources or pinned downloads. They are not backed up by cleanup. Retained Run evidence is still needed to inspect failures and reproduce the recorded inputs; a replay command cannot restore missing dirty sources, missing external prerequisites or unavailable downloads. Test packed consumers using disposable data before applying a policy to real workloads; see [distribution](distribution.md) and [support limits](support.md).
