# Survival acquisition checks with CraftAtlas

This repository-only suite uses the pinned `projects/craft-atlas` submodule's actual snapshot reader, schema validator, normalizer, and reachability analyzer. It accepts an Atlas snapshot JSON or completed capture directory, including checksum/session/generation checks. It does not install Atlas, call its CLI's success exit an acquisition pass, or claim game validation from offline data. Root npm install/build/pack stays independent; the tool and submodule are not part of the npm consumer API.

The common scope is **Fabric/NeoForge 1.21.1 and Forge/Fabric 1.20.1**, selected by exact Minecraft/loader pairs. Other combinations and unsupported recipe adapters remain unsupported. A saved capture must match the configured Minecraft/loader and the active harness target (including its declared loader version). Normalization uses Atlas's exact adapter/mod-version support and retains unsupported data.

| Target | Loader | Gradle / compile / game Java | Recipe resource path | Viewer | Finite commands |
| --- | --- | --- | --- | --- | --- |
| NeoForge 1.21.1 | 21.1.252 | 21 / 21 / 21 | `recipe` | JEI | loot/block/entity/world |
| Fabric 1.21.1 | 0.16.14 | 21 / 21 / 21 | `recipe` | EMI | unsupported |
| Forge 1.20.1 | 47.3.0 | 17 / 17 / 17 | `recipes` | JEI 15 | loot/block/entity/world |
| Fabric 1.20.1 | 0.16.14 | 21 / 17 / 17 | `recipes` | EMI | loot/block/entity/world |

Command registration coverage and finite-sample coverage are separate. Completed finite loot/block/entity/world observations on both 1.20.1 loaders retain seeds, player/luck, tool NBT, damage context and chunk/height bounds. They remain partial samples, never exhaustive absence, sustainable supply or survival progression proofs. Block/entity sampling does not execute real break/death events; unknown arbitrary hooks and incomplete contexts remain unknown. Fabric 1.21.1's observation limitation is unchanged. Forge fluid runtime behavior remains unverified: PR #6's JEI test pack had no fluid slots.

Results retain raw `recipes` (including 1.20.1 network bytes and hashes), `viewer`, `world`, normalized `observationProcesses` and `sourceEvidence`, alongside datapack provenance and original/effective coverage. A finite observation cannot close the scenario even if its finite-coverage row is missing or claims complete. Stale observation session/generation/environment or a mismatched 1.20.1 target is rejected. Network bytes are provenance, not a JSON interpretation or a reviewed execution route; serialization errors and missing semantic records continue to block a pass. Viewer quantities and backing IDs do not establish execution or probability.

## Diagnostic summaries and complete details

Each result case has a human `message` bounded to 1,800 UTF-16 code units. It names the target, expected/Atlas verdicts, incomplete/unknown/stop-reason counts, the first two examples per category in evidence order, omitted record counts and a next action. Examples are limited to 160 units; stop examples also name their kind and target. Text is single-line, uses `…` for abbreviated text and never cuts a surrogate pair. `omitted` counts records beyond the examples, not characters or unique causes. No filtering, abbreviated text or representative example changes a verdict.

For automation, use `id`, `status`, `diagnostics.schemaVersion: 1`, `diagnostics.counts.{incomplete,unknown,stopReasons}` and `detail.{file,pointer}`. Do not parse `message`; its prose is a human summary. Counts include all original records, including repeated reasons. `detail.pointer` is an RFC 6901 JSON Pointer to the full case in the companion `<results>.evidence.json`. In standalone results, `detail.file` is relative to the results file's directory. The runner validates the file/pointer, converts the path to Run-relative form and registers the complete companion and results file once in `suite.evidence`. In reports and JUnit, resolve detail files from the directory containing `report.json`/`junit.xml`. Persisted survival counts require a detail reference. The result reader, Run writer/reader and CI collector verify the companion, pointer, evidence version and complete counts; missing or inconsistent detail is an error, never a successful case or silently omitted artifact.

Survival evidence uses **schemaVersion 2**, with `diagnosticContractVersion: 1`. It stores common full reasons once at top-level `incomplete`; each `details[i].incompleteRef` is `#/incomplete`. This version bump distinguishes the layout from legacy evidence schemaVersion 1, which stores per-case `incomplete` arrays. Current readers accept both explicit layouts and reject unknown evidence/diagnostic versions. Per-case `analysis.unknown`, structured `analysis.stopReasons` (kind, target, process, message, evidence), route, provider provenance and limitations remain complete. Coverage, development/definition/resource diagnostics and raw datasets remain complete and can be large. Input captures are never rewritten. The evidence is for inspection and machine analysis, and is never embedded back into CLI/report/JUnit messages.

Result and Run-report envelopes remain **schemaVersion 1**: existing fields/verdicts are unchanged, and `detail`/versioned `diagnostics` are optional extensions. Foundry **0.1.7 or later** is required to consume the new producer's metadata. This is backward reading compatibility, not a guarantee that older strict binaries accept new fields. Update the consuming Mod's installed Foundry package together with this repository's producer; old binaries reject unknown case properties rather than misclassifying them. Existing results/reports without these fields still work. The pinned Atlas consumer emits ordinary schemaVersion 1 cases and does not read Foundry survival evidence; its independent Foundry 0.1.5 pin and source code need no changes. The in-repository case parser, Run schema/types, report writer/reader, CI collector/template and survival integration tests handle the new contract. Bundled Skills take the installed package's current provenance automatically.

Normal and JSON `mch test`/`mch report` output carry the same compact cases and references. JUnit failure/error/skipped messages use at most 1,800 units of human text before XML escaping, followed by a detail reference; XML escaping can increase the byte length. For unrelated oversized driver messages, JUnit instead references the complete message in `report.json`. Passed cases retain details in JSON. Required unsupported/skipped cases still become JUnit errors and fail suite acceptance.

Keep the complete Run directory, or collect evidence using the bundled CI collector, preserving relative paths. The collector validates and copies declared JSON companions without embedding them into the report. To inspect a downloaded `runs/<id>/` artifact with `mch report`, copy that Run under a project's `.harness/runs/<id>/`; no absolute source-machine path is needed. Standalone Atlas CI already retains the results and `.evidence.json` together. An artifact containing only JUnit or only `report.json` cannot resolve a companion and current readers report that missing evidence. The installed npm package accepts and retains these results, while the Atlas producer and its pinned submodule remain repository-only.

## Active datapack authoring evidence

The pin includes Atlas's active-server `datapack.json` capture. Follow [the acquisition template](../templates/acquisition/README.md#inspect-active-datapack-evidence-first) to query `atlas datapack`, compare RecipeManager entries and inspect effective raw text/parsed JSON/byte hashes, visible override stacks and pack IDs before authoring definitions. Capture is independent of viewers; custom directories require `-Dcraftatlas.resourceDirectories=...` on the game JVM. Keep completed captures from the actual built Mod and reload generation with the Run. Older snapshots remain accepted, but absent raw data is not evidence that resources do not exist.

Raw presence never proves execution or closed acquisition coverage. Source-only/script-removed JSON remains opaque/unconfirmed until an explicit definition execution review; custom-directory data has unsupported interpretation coverage even when a reviewed addition exists. Unknown conditions, power, runtime APIs and costs remain unknown. Foundry also flags malformed resource evidence and source/runtime serializer conflicts, and requires an explicit definition execution review plus mechanism/regression declarations for runtime-only entries when raw capture is present. Do not discard resources or replace transformations with provider seeds to bypass these checks.

The result's `.evidence.json` retains the full `datapack` dataset (or null for legacy captures), `resourceDiagnostics`, and effective `definitionProcesses` including original raw data, field evidence/history and execution state, alongside definition hashes and original/effective coverage. Raw capture coverage is never promoted by overlays or external surveys. A raw-resource diff shows evidence changes; it does not establish a runtime behavior change.

## Restore and run offline regressions

From the Foundry root, with Node 24.19.0 and npm 11.9.0:

```console
git submodule update --init projects/craft-atlas
npm ci --ignore-scripts
npm run check:atlas
npm run test:atlas
node scripts/atlas-survival.mjs --config tests/atlas/fixtures/suite.json --results .harness/atlas-survival/results.json
```

The committed small snapshot is synthetic, schema-valid Atlas input, not a live game capture. Its seven regression expectations cover a known obtainable item, no-source item, missing AND ingredient, cycle without a seed, alternative recipes, a tag with an available member, and an empty tag. Node tests additionally cover a cycle with a loot seed, OR ingredient alternatives, unsupported predicates/components, finite supply, missing external coverage, partial captures, and out-of-scope targets. Both supported loaders run through the real Atlas normalizer. An Atlas-owned `fixtures/before.json` integration verifies its actual recipe/tag route and the unsupported verdict caused by its incomplete coverage. Expected `unreachable` passes only a regression assertion; it does not mean that item is survival obtainable.

The CLI exits 0 when all acquisition expectations pass, 1 for failed/unsupported results, and 2 for configuration/access errors. It writes Foundry result schema 1 and a companion `<results>.evidence.json` with the Atlas commit, snapshot/config/model hashes, effective scenario, source declarations, route evidence, missing inputs, unknowns and limitations. No selected/detected items is an error. `--mod <namespace>` selects captured item IDs by namespace, not registration ownership across namespaces. `--items <id,id>` narrows the selection; unknown/out-of-filter items are rejected. With no explicit cases, all selected registry items are expected to be reachable.

## Check a captured Mod

Copy the [suite configuration](../tests/atlas/fixtures/suite.json) to your project, change `snapshot` to the relative path of the current Atlas capture, set `target`, replace the fictional scenario/provider/survey declarations with reviewed facts, and remove `cases`. Set `mod` to the item namespace, or supply `items`. The [suite schema](../schemas/atlas-survival.schema.json) rejects unknown fields; Atlas validates the embedded scenario. Do not reuse the fixture's completeness assertions for a real Mod. Use dedicated/integrated Atlas collectors as described in [Atlas usage](../projects/craft-atlas/docs/usage.md); this tool does not launch Minecraft or accept its EULA.

```console
node scripts/atlas-survival.mjs --config /path/to/mod/survival.json --mod example --items example:gear,example:machine --results .harness/atlas-survival/mod-results.json
```

Recipes are transformations, not a complete list of survival sources. `providers` explicitly seeds **available** item types with an evidence reference and source kind (`loot`, `drops`, `harvesting`, `worldgen`, `trades`, `other`); `unknown` providers add uncertainty and never seed inventory. Positive starting inventory also requires an available provider. Installed equipment, stages, dimensions and game rules remain explicit scenario assumptions, not proven installation/unlock paths.

`externalSources` must survey each of those six categories, with `complete`, `partial` or `unsupported` and an evidence reference. `complete` is the caller's reviewed assertion for the scenario's scope, not a proof the tool derives from absent loot tables or recipes. A reviewed category with no possible sources can be complete; unknown custom hooks must remain partial/unsupported. Provider/survey declarations do not replace, upgrade or delete Atlas capture/normalization coverage. Explicit reviewed definitions can recompute derived interpretation coverage as described below; raw capture coverage remains unchanged. Any incomplete capture/coverage/survey or unconfirmed provider makes the acquisition cases unsupported, even when a known recipe route exists. Missing surveys open the scenario before analysis, preventing an unsupported absence claim.

Within complete data, Atlas uses a qualitative least fixed point: all input slots are required, each slot may choose one alternative/tag member, and a cycle cannot create an initial supply. Negative results additionally require explicit closed resources covering the target and every dependency. Open domains produce unknown; unknown becomes a required harness failure. Nonzero loot probabilities prove possible acquisition, not guaranteed outcomes. Finite stock scheduling, exact components, enough fuel/durability, renewable world supply and arbitrary Mod code remain outside this initial suite. Preserve Atlas's diagnostics and limits when reviewing a result.

## Connect the existing harness process driver

Add a suite/runtime to the consuming Mod's `harness.config.json` and add `survival-acquisition` to the appropriate supported target's `requiredSuites`. Use your actual Foundry checkout path in the runtime argument; the executable receives each argument separately, including Windows paths with spaces. Configuration paths belong to that Mod project; result paths belong to the isolated session:

```json
{
  "suites": {
    "survival-acquisition": {
      "driver": "process", "runtime": "atlas-analysis", "results": "survival.json",
      "minTests": 1, "expectedTests": ["survival:example:gear"],
      "requiredCapabilities": ["atlas-saved-snapshot"]
    }
  },
  "runtimes": {
    "atlas-analysis": {
      "kind": "server", "capabilities": ["atlas-saved-snapshot"],
      "command": {
        "executable": "node",
        "args": ["/path/to/CraftFoundry/scripts/atlas-survival.mjs", "--config", "{projectRoot}/survival.json", "--results", "{sessionRoot}/survival.json", "--harness"]
      }
    }
  }
}
```

```console
mch test --target neoforge-1.21.1 --suite survival-acquisition --json
```

`--harness` returns a successful transport exit after writing valid cases so the process driver can read them; it never changes case verdicts. Required failed/unsupported cases fail the suite. Input/access failures still exit 2 without results. The harness builds the Mod before running the suite. Required process execution now checks capture identity: configure `captureRuntime` to launch/capture that same distribution automatically using the procedure below. A saved snapshot without current trusted expected identity is unsupported and cannot pass a required suite. Direct offline review remains available for older snapshots. Keep the companion evidence under the Run's session and retain it alongside the report. Offline regression success is independent of real-world acquisition testing or release validation.

## Fresh capture and built JAR identity

Foundry 0.1.8 provides identity contract v1 (`craft-foundry/core/capture-identity`). Set `captureRuntime` in the survival configuration to a dedicated runtime from the consuming Mod's `harness.config.json`. The Mod's current artifact exporter must record its distribution and all relevant dependency Mods, including the compatible CraftAtlas collector, as `distribution`/`runtime-dependency` artifacts with server/both sides. Do not select arbitrary JARs from a directory. Tool/loader pins remain in the harness lock and report.

```json
{
  "captureRuntime": "dedicated-server-with-atlas",
  "captureFiles": [
    { "source": "validation/config", "destination": "config" },
    { "source": "validation/datapack", "destination": "world/datapacks/validation" }
  ]
}
```

This is a fragment of the existing survival configuration. Keep the required `snapshot` field for offline review; automatic capture ignores its saved path during that execution. `captureFiles` sources resolve within the consuming project, and destinations are limited to owned config/defaultconfig/script/kubejs/world-serverconfig/datapack paths. Files and trees are checked before copying; symlinks/escaping paths and overwrites are rejected. Prepare the intended inputs before startup. No personal world is used or copied. Server properties remain the harness's isolated loopback fixture properties; scenario/game-rule assumptions must be reviewed against the captured runtime environment.

Run the configured required process suite through `mch test`. The harness supplies the current Run and target to the analysis process. The runner verifies the content-addressed build artifact manifest, prepares a new disposable dedicated session and deploys hash-matching server distributions/dependencies. It issues a random launch nonce before startup, queries the collector's live session/generation, then independently creates `capture-expectation.json` from that Run's trusted artifacts and the prepared running session's complete relevant file inventory before sending a unique dump request. Configs generated by this fresh boot are frozen in that expected inventory; they must also match collector startup measurements and are not read from a prior dump. A successful transport exit is still followed by required case evaluation.

The collector measures actual loaded Mod-origin JAR bytes at server startup and again at capture. Only a harness-armed launch publishes the optional identity field; ordinary unarmed captures preserve the legacy format for older strict readers. It reads the nonce once at startup and publishes identity for the unique request, session and generation. It independently hashes all regular files in `mods`, `config`, `defaultconfigs`, `kubejs`, `scripts`, `world/serverconfig`, `world/datapacks`, plus `server.properties`. Directly declared `-D` game arguments are measured through actual JVM properties named at launch. Each expected distribution/dependency must be present at a measured loaded origin and in the deployed file inventory; unknown extra deployed dependencies are rejected. Loaded JAR bytes, boot configuration and declared JVM properties must match their independently recorded startup fingerprints. Changing configuration after startup cannot be certified merely by freezing its new file bytes before the dump; fully restart with the applied configuration. All relevant file inputs, including datapacks and scripts, must match the complete independently measured startup inventory. This conservative v1 contract requires a full process restart after any such file change, because a reload does not prove that arbitrary Mod code applied it. Reloads with unchanged bytes still require a fresh live-generation capture. Changed loaded JAR bytes require a full process restart. A restart gets a new collector session and launch nonce; reload increments generation. Neither can relabel an old dump as current.

Missing identity/contract, development-directory origins or incomplete measurement is unsupported. Comparisons against the expected target/nonce/request/session/generation, JAR/dependency/config/datapack/script/JVM inputs fail on mismatch; changed boot configuration/JARs or incomplete collector measurements remain unverifiable. All outcomes include actionable identity diagnostics, with actions to restore/rebuild/redeploy, restart and recapture. Either status blocks required acquisition success even if an old snapshot has a reachable route. The identity gate never upgrades unsupported serializers, incomplete surveys, unknown hooks or finite observations into exhaustive acquisition. These are file/runtime provenance checks, not signed remote attestation or a proof that every external service/environment variable/custom code path is covered. Undeclared JVM flags, external configuration outside the owned roots, custom world directory names and integrated-client acquisition identity need explicit support before they can establish required identity.

The Run retains `capture-expectation.json`, launch/lifecycle evidence, both process logs, the complete raw snapshot directory (manifest/completion/JSON/JSONL), and the existing schemaVersion 2 survival companion with compact diagnostics and all complete details. `captureEvidence` v1 lists companion-relative files and SHA-256 values. Foundry retention, report inspection and CI evidence collection validate these bytes and fail on missing/tampered raw evidence. Legacy result/report envelopes and saved snapshots without this optional data remain readable; legacy review alone is not a current-build release check.

Automatic capture requires an Atlas source API exporting `captureIdentityContractVersion = 1` and collector JARs with `RuntimeIdentity`. The recorded gitlink supplies that interface from a reachable candidate whose runtime code has been validated on all four supported targets. The default runner uses this exact clean pin; no source override is required. A clean explicit `--atlas-source <candidate-checkout>` remains available for development and records its exact commit. Review and merge the coordinated Atlas change first, then Foundry; if Atlas is squash-merged, repin to its final reachable reviewed SHA and rerun default-pin integration. Never record an unpushed SHA, replace the submodule with a copied sibling, or change Atlas's independent Foundry bootstrap pin to this feature branch. Legacy Atlas sources remain usable for offline suites and reject the unsupported fresh-capture path explicitly.

Cloud validation exercises actual dummy process lifetimes, file inventories, replay/config mismatch, checksum/companion contracts and pure Java 17/21 identity measurements. The four supported collector/fixture targets have also been compiled and validated locally with clean restart persistence, fresh capture identity, changed-input rejection and retained-evidence replay checks. Repeat affected game checks after runtime changes; cloud contracts alone establish no game pass.

## CI

[Atlas survival CI](../.github/workflows/atlas.yml) verifies the exact gitlink, initializes a real submodule and runs all four targets' offline contracts on Windows/Ubuntu. Ordinary [Foundry contracts](../.github/workflows/contracts.yml) remain independent of Atlas access. Source acquisition failures fail the Atlas job explicitly, never skip it into green status.

For an existing local checkout at the pinned SHA, `node .github/scripts/prepare-atlas.mjs --source <checkout>` initializes the gitlink using a command-local local-source override and restores the canonical remote. It never installs Atlas's parent dependency or alters Atlas main. Full Atlas consumer validation can separately run its `prepare-foundry.mjs --source ../..`, frozen pnpm install, check/test/build; it keeps Atlas's independent Foundry pin and does not consume Foundry dev automatically.

## Per-Mod acquisition definitions and development checks

`definitions` is an opt-in array of DefinitionPack JSON paths relative to the suite. The runner schema-validates every file, checks namespaced pack IDs, exact installed Mod targets and verification references, then applies Atlas's deterministic overlay before reachability analysis. Missing/malformed files stop execution; duplicates, mismatched versions, unmatched selectors, conflicts and missing captured resources/tags produce actionable diagnostics and unsupported cases. Pack order cannot silently select a winner. Results record pack content hashes, versions, original/effective coverage and all definition/development diagnostics.

Use [the authoring template](../templates/acquisition/README.md) and its small [definition example](../templates/acquisition/definitions.json). A custom serializer can explicitly replace reviewed inputs, outputs, requirements, execution, unknowns and interpretation. Code acquisition outside recipe enumeration can add a process. Both are transformations with AND materials/OR choices and conditions; `providers` remains reserved for reviewed initial supply. Tag members come from the current snapshot. Existing Atlas conditions, cycles, equipment, catalysts, durability and probability limitations apply. Dynamic code is not inferred or executed by this check.

Declare each custom mechanism in `mechanisms` with a namespaced ID, owning Mod, mapped process IDs and evidence. Use `unknown` for unverified Java hooks. The check reports unsupported serializers/sources, unregistered definition processes, absent mappings/Mods and missing regression cases with actions to add/update definitions and tests. Each modeled mechanism needs an output's positive case and a missing-prerequisite case with `without`. `without` removes initial inventory/equipment/stage/dimension assumptions for that case only; alternate processes remain available. Expected unreachable is regression behavior, not a production acquisition pass. Unlisted arbitrary Java methods cannot be detected reliably: the setup/development Skills require explicit mechanism review when acquisition code changes.

After an overlay, Atlas rebuilds only derived recipe interpretation coverage and adds coverage for additional processes; raw recipe/world/viewer acquisition coverage is unchanged. The Foundry evidence retains original coverage. Unverified hooks, unknown costs/constraints/predicates, incomplete captures and external surveys still block a green suite. Historical runtime unsupported diagnostics remain available alongside field replacement history.

The tracked Atlas gitlink supplies `definitionContractVersion = 2` from a reachable commit. Normal development and CI use the pinned submodule without a local source override:

```console
npm run check:atlas
npm run test:atlas
npm run test:atlas:definitions
node scripts/atlas-survival.mjs --config tests/atlas-definitions/fixtures/suite.json --results .harness/custom/results.json
```

`--atlas-source` is a development override only and is recorded with the full clean checkout commit in evidence. Without it the CLI still verifies a clean checkout at the exact recorded gitlink. Definition suites require contract v2; the recorded pin supplies it for all four targets. Root install/build/pack still does not install or ship Atlas.

The Windows/Ubuntu Atlas integration CI runs all three integration checks and both representative suites through the default pinned path. Definition regressions exercise datapack overrides, unknown serializers, source-only/script-removed and runtime-only paths, explicit execution review and raw provenance for all four targets. For future definition contract updates, publish the reviewed Atlas commit first, update Foundry's gitlink to its final reachable SHA, then deliver Foundry. Re-run all three Atlas integration checks without the source override after each pin update. If Atlas is squash-merged, use the resulting remote SHA. Keep Atlas's independent Foundry package pin and lockfile unchanged. Publishing, PR changes and pin delivery require separate user authorization.

## Validate coordinated candidates without changing original pins

Record full immutable candidate commits for both repositories (`git rev-parse HEAD`), the original gitlink and `craft-foundry.source.json`, and SHA-256 of the packed Foundry 0.1.8 tarball. Use separate disposable checkouts at those exact commits, leaving original projects, worlds, package manifests and lockfiles untouched. Initialize Foundry's recorded gitlink normally and run its default pinned offline integration first.

In the separate Atlas candidate checkout, run its normal `prepare-foundry.mjs` and frozen install against the original reachable Foundry 0.1.5 pin. Then install the exact candidate tarball into that disposable checkout's ignored `.harness/vendor/` using `pnpm add -D craft-foundry@file:./.harness/vendor/craft-foundry-0.1.8.tgz --ignore-scripts`. Preserve both original pin/integrity and the overlay lock/integrity with the Run. Do not rerun bootstrap over the candidate or commit that overlay. Keep an additional clean Atlas candidate checkout for `--atlas-source`; the intentional package-overlay manifest/lock changes cannot satisfy the source-cleanliness guard. Compile the four collector targets and produce artifact manifests before using their collector JARs as dependencies in the consuming Mod's own build exporter. In its disposable validation overlay, invoke the candidate Foundry repository's survival runner with `--atlas-source` pointing to the clean exact Atlas candidate checkout. Run the same consuming Mod's `mch test` process suite so its current built artifact record is the trusted expectation.

Use the existing accepted EULA state and locally configured Java homes/tools/backend; choose test/start/stop deadlines sufficient for two server boots or automatic capture (the process driver deadline covers its entire child session). Run `doctor`, `inspect` and `build` for all four targets in each disposable candidate checkout. Perform the four [persistence target checks](persistence.md#validate-the-four-targets-locally), then the normal Foundry fixture release profile and Atlas release profile (15 suites / 50 cases). Repeat Atlas's two 1.20.1 JEI/EMI viewer suites with `CRAFTATLAS_OBSERVATION_PERMISSION=denied`, using its documented separate worlds. Prior results do not replace candidate validation. For acquisition identity on each of NeoForge/Fabric 1.21.1 and Forge/Fabric 1.20.1:

| Check | Required outcome |
| --- | --- |
| Current built distribution + recorded dependencies + fresh capture | Identity passed; acquisition may still be unsupported/unknown because of semantic coverage |
| Rebuild/replace Mod JAR or dependency | Old capture rejected; fresh same-build capture required |
| Change config, datapack, script or declared game JVM property | Old expected identity rejected; fully restart with intended bytes and request a new capture |
| Change any relevant input after startup but before the expected manifest is frozen | Unverifiable boot inventory rejected; new hashes matching each other cannot certify applied inputs |
| Restart process / reload generation | Prior nonce/session or generation rejected; new live identity verified |
| Old/missing identity / unsupported origin | Unsupported required cases, never a release pass |
| Edit/delete raw snapshot, expectation or companion evidence | Input/retention/report inspection fails |
| Read an old standalone snapshot outside a required current-build run | Legacy analysis remains readable and is described as offline review |
| Actual sample observations or unknown hooks | Their existing partial/unknown semantics remain unchanged even when identity passes |

Preserve failed attempts, complete raw provenance, candidate commit/package/overlay identities and all logs. Check cleanup after success, failure, cancellation and timeout. A fresh identity pass establishes which bytes were analyzed, not exhaustive acquisition or crash-recovery persistence. Local game execution needs its separate task authorization.
