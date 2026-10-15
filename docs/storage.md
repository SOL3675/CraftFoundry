# Storage management

Use `mch storage` to inspect a project's `.harness` data before changing its storage policy. Storage settings live in ignored `harness.local.json`; they do not belong in shared configuration or a package. All defaults preserve existing behavior. Foundry 0.1.9 does not adopt or delete historical unmarked caches.

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

`managedCaches` and `sharedAssets` default to `false`; `cleanup` defaults to `"retain"`. Asset reuse can be enabled independently; `cleanup: "after-run"` requires `managedCaches: true`. Managed client dependency caches use `.harness/c/<uuid>/mct-cache` instead of placing the dependency cache inside the Run. Ownership and completion metadata distinguish these units from older client directories. Turning the setting on does not migrate existing data.

The following data stays retained:

| Data | Policy |
| --- | --- |
| Run reports, JUnit, results, logs, screenshots and captured evidence | Retain; finalize and hash-check evidence before dependency cleanup |
| Worlds, runtime settings, `mct-home`, deployed Mods and `.native-aliases` | Retain; never treat these as reclaimable dependency caches |
| Existing unmarked `.harness/c`, `.harness/runs` and other caches | Retain; no automatic adoption |
| Active, ambiguously owned or incompletely finalized managed units | Retain with a reason |
| External paths and links/junctions | Exclude; never traverse a link to reclaim its destination |
| Eligible new managed client dependency cache | Preview first; reclaim only with explicit apply or opt-in after-run policy |

Cleanup is limited to `.harness/c/<uuid>/mct-cache/client`, the managed client dependency subtree. The unit's `unitId` is a separate ownership identity. Cleanup does not delete an entire Run, client home, world or generic Gradle cache. Required reproduction inputs and evidence remain part of the Run. Failed results keep their original status and evidence; reclaiming a disposable dependency cache cannot turn them into a pass.

## Share verified assets

`sharedAssets: true` enables reuse through `.harness/cache/shared-assets/<minecraft-version>` of content-addressed Minecraft `assets/objects/<prefix>/<sha1>` and `assets/indexes/<sha1>.json`. Version scopes avoid seeding unrelated versions into every session. SHA-1 must match the content-addressed name on import, reuse and session materialization. The harness attempts copy-on-write clones and falls back to regular independent copies where cloning is unsupported. It does not use writable hard links to connect a game session to shared data. Every session can therefore write its own files without changing another session's asset bytes.

Only immutable, revalidated asset bytes qualify. Objects are bounded at 128 MiB, indexes at 16 MiB, and index references and scanned asset counts at 100,000. Prepared markers, extracted native libraries, runtime dependencies outside this asset contract, worlds, settings and run evidence are not shared. An invalid hash is an error, never a reason to weaken verification. Shared assets can outlive an individual managed client cache; cleanup does not infer that a shared object is unused. Independent publishers use exclusive temporary files and atomic publication so one session cannot overwrite another publisher's object.

Copy-on-write support depends on the operating system and filesystem. A successful clone request can still fall back to a full copy on Windows/NTFS. Logical byte counts may count identical or cloned files more than once and do not describe allocated physical bytes, free space or guaranteed reclaimable capacity. Compare free-space measurements separately when evaluating a candidate.

## Completion and cleanup safety

`cleanup: "retain"` keeps newly managed caches for inspection until explicit cleanup. `cleanup: "after-run"` requests automatic reclamation only for future eligible units. The existing runtime `cleanup: true` option continues to control owned process shutdown; it is not a disk-retention setting.

A unit becomes eligible only after its owned process has ended normally and its Run evidence has been finalized and verified. Uncertain ownership, an interrupted save, missing or changed proof, a still-running process, a linked path or a path outside the managed root keeps the unit retained. Cleanup uses ownership coordination and validates paths again when applying. A crash or forced termination can leave a retained unit; do not edit its ownership/proof metadata merely to make it eligible. Investigate it and preserve evidence before any separately authorized manual action.

Built-in drivers first await owned client/server disposal, then retain logs, crash evidence and the cleanup trace. They publish stopped-unit callbacks only after that entire phase succeeds, including server evidence collection. The runner writes the finished report and JUnit before sealing any unit. A gameplay assertion failure may still have complete evidence; a stop, evidence-save, report-save or seal failure does not authorize reclamation.

Unit records contain the cache path, owner-token hash, PID and a random owner process-instance identity, lifecycle state, cache file metadata and the retained Run manifest. Every regular Run file has a SHA-256, size and modification identity; overlay links are recorded without following targets and cannot supply referenced evidence. Exclusive path claims prevent duplicate owners. Finalization requires the original process instance and token, so PID reuse or a persisted old token cannot recover an active unit. Once sealed, a later cleanup invocation may validate that completed proof without recovering live process ownership.

The JSON inventory uses `schemaVersion: 1`, `sizeKind: "logical"`, `totalBytes`, `reclaimableBytes`, `retainedBytes`, `availableBytes` and `entries`. `availableBytes` is a separate filesystem free-space observation, or `null` if unavailable. Each entry includes `path`, `kind`, `logicalBytes`, `disposition` (`retain`, `reclaim` or `deleted`), `reason` and, when known, `unitId`. Cleanup also returns `apply`, `deletedBytes`, `errors` and an `auditPath` for applied operations. Ownership records are under `.harness/storage/units/`; applied operations write `.harness/storage/audits/<uuid>.json` before deletion and update it with outcomes. Preserve this output with the reviewed operation.

Durable audits add `auditSchemaVersion: 1` and `entryScope: "selected-managed-units"`. Their `entries` list the selected units; `retainedScope` records the exact complement under `.harness` using `exceptCacheRoots`, with observed retained logical bytes and entry count. This keeps unrelated historical file lists out of each new audit. CLI inventory and cleanup responses still include the full observed file list.

Partial deletion or an I/O error remains visible; rerunning cleanup must re-evaluate the remaining unit rather than assuming the previous attempt succeeded. Disk exhaustion or an incomplete evidence save does not qualify the unit for automatic reclamation. An interrupted cleanup can leave `.harness/storage/cleanup.lock`; verify the recorded owner has ended and inspect the audit before recovering that lock. A stale PID alone is not sufficient ownership evidence.

Finalization and cleanup hash the full retained Run, without following overlay links. Large Runs and several clients sharing a Run can require repeated file reads and sizable ownership manifests. Inventory sizes are observations while other runs may still be writing; they are estimates rather than a filesystem snapshot. Keep adequate free space for evidence and audit writes before opting in. Disk-full behavior is covered through fail-closed write boundaries; filling a real disk is not part of the contract tests.

## Runtime integration API

Consumers owning a custom test runtime can import `createStorageUnit`, `finalizeStorageUnit`, `inventoryStorage` and `cleanupStorage` from `craft-foundry/core/storage`. Register a new, nonexistent `.harness/c/<uuid>/mct-cache/client` before preparation and retain the returned `{ id, ownerToken }` in the owning process. Registration cannot adopt an existing directory. The dependency directory UUID and ownership `id` are separate identities.

After the runtime has positively confirmed that every process using the unit has stopped, saved all required evidence and completed the Run report/JUnit, call `finalizeStorageUnit(projectRoot, handle, { stopped: true, evidenceRoot: runRoot })` in the same owning process. The API validates the owner token/current process, finished report, referenced regular evidence files and full Run SHA-256 snapshot before sealing. Do not derive `stopped: true` merely from PID absence, a stale lock, a timeout, or an attempted stop. A custom runtime must prove its own lifecycle before attesting completion. Failed assertions can still have complete retained evidence; failed shutdown cannot satisfy this contract.

The exclusive cleanup lock coordinates harness cleanup processes; managed roots must not be repurposed or written by external processes after shutdown. Applying a preview rebuilds the candidate list and revalidates ownership, evidence, links and cache metadata before deletion; every file's type, size and modification identity is checked again immediately before unlinking. Shared assets are outside every eligible subtree and are never garbage-collected, including while other runs reference them. Native locks or partial I/O failures retain the remaining files and are reported for a fresh retry.

`inventoryStorage(projectRoot)` returns the inventory above. `cleanupStorage(projectRoot)` previews; `cleanupStorage(projectRoot, { apply: true, unitIds: [id] })` applies an authorized selection after revalidation. The public API does not infer or stop custom runtime processes and does not supply missing evidence. Prefer leaving a unit active over attesting uncertain completion.

## Upgrade and recovery

Install the exact reviewed `craft-foundry-0.1.9.tgz`, keeping its integrity in the consumer lockfile, then update bundled Skills with `mch skills install --destination .agents/skills --json`. Review the installer's `preserved` customizations. Existing configuration and reports remain schema version 1. Start with inventory and a dry-run, and opt in through local configuration for subsequent Runs. A candidate package does not authorize clearing historical user data.

Reclaimed dependencies are restored by normal preparation from valid local sources or pinned downloads. They are not backed up by cleanup. Retained Run evidence is still needed to inspect failures and reproduce the recorded inputs; a replay command cannot restore missing dirty sources, missing external prerequisites or unavailable downloads. Test packed consumers using disposable data before applying a policy to real workloads; see [distribution](distribution.md) and [support limits](support.md).
