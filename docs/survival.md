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

For automation, use `id`, `status`, `diagnostics.schemaVersion: 1`, `diagnostics.counts.{incomplete,unknown,stopReasons}` and `detail.{file,pointer}`. Do not parse `message`; its prose is a human summary. Counts include all original records, including repeated reasons. `detail.pointer` is an RFC 6901 JSON Pointer to the full case in the companion `<results>.evidence.json`. In standalone results, `detail.file` is relative to the results file's directory. The runner validates the file/pointer, converts the path to Run-relative form and registers the complete companion and results file once in `suite.evidence`. In reports and JUnit, resolve detail files from the directory containing `report.json`/`junit.xml`. These optional result/report fields extend schemaVersion 1; older strict parsers need the updated Foundry package to accept them.

The evidence's `diagnosticContractVersion: 1` stores common full reasons once at top-level `incomplete`; each `details[i].incompleteRef` is `#/incomplete`. Readers of the earlier per-case `incomplete` array must follow this reference. Per-case `analysis.unknown`, structured `analysis.stopReasons` (kind, target, process, message, evidence), route, provider provenance and limitations remain complete. Coverage, development/definition/resource diagnostics and raw datasets remain complete and can be large. Input captures are never rewritten. The evidence is for inspection and machine analysis, and is never embedded back into CLI/report/JUnit messages.

Normal and JSON `mch test`/`mch report` output carry the same compact cases and references. JUnit failure/error/skipped messages use at most 1,800 units of human text before XML escaping, followed by a detail reference; XML escaping can increase the byte length. For unrelated oversized driver messages, JUnit instead references the complete message in `report.json`. Passed cases retain details in JSON. Required unsupported/skipped cases still become JUnit errors and fail suite acceptance.

Keep the complete Run directory, or collect evidence using the bundled CI collector, preserving relative paths. The collector copies registered session JSON companions without loading them into the report. Standalone Atlas CI already retains the results and `.evidence.json` together. An artifact containing only JUnit or only `report.json` cannot resolve a companion. The installed npm package accepts and retains these results, while the Atlas producer and its pinned submodule remain repository-only.

## Active datapack authoring evidence

The pin includes Atlas's active-server `datapack.json` capture. Follow [the acquisition template](../templates/acquisition/README.md#inspect-active-datapack-evidence-first) to query `atlas datapack`, compare RecipeManager entries and inspect effective raw text/parsed JSON/byte hashes, visible override stacks and pack IDs before authoring definitions. Capture is independent of viewers; custom directories require `-Dcraftatlas.resourceDirectories=...` on the game JVM. Keep completed captures from the actual built Mod and reload generation with the Run. Older snapshots remain accepted, but absent raw data is not evidence that resources do not exist.

Raw presence never proves execution or closed acquisition coverage. Source-only/script-removed JSON remains opaque/unconfirmed until an explicit definition execution review; custom-directory data has unsupported interpretation coverage even when a reviewed addition exists. Unknown conditions, power, runtime APIs and costs remain unknown. Foundry also flags malformed resource evidence and source/runtime serializer conflicts, and requires an explicit definition execution review plus mechanism/regression declarations for runtime-only entries when raw capture is present. Do not discard resources or replace transformations with provider seeds to bypass these checks.

The result's `.evidence.json` retains the full `datapack` dataset (or null for legacy captures), `resourceDiagnostics`, and effective `definitionProcesses` including original raw data, field evidence/history and execution state, alongside definition hashes and original/effective coverage. Raw capture coverage is never promoted by overlays or external surveys. A raw-resource diff shows evidence changes; it does not establish a runtime behavior change.

## Restore and run offline regressions

From the Foundry root, with Node 24.19.0, npm 11.9.0 and already authorized Git access:

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

`--harness` returns a successful transport exit after writing valid cases so the process driver can read them; it never changes case verdicts. Required failed/unsupported cases fail the suite. Input/access failures still exit 2 without results. The harness builds the Mod before running the suite; collect a fresh Atlas snapshot of that same distribution/configuration rather than reusing unrelated saved data. This initial suite does not automatically prove capture-to-JAR identity or launch/capture the game. Keep the companion evidence under the Run's session and retain it alongside the report. Offline regression success is independent of real-world acquisition testing or release validation.

## Private submodule CI

[Atlas survival CI](../.github/workflows/atlas.yml) verifies the exact gitlink, initializes a real submodule and runs all four targets' offline contracts on Windows/Ubuntu. Ordinary [Foundry contracts](../.github/workflows/contracts.yml) remain independent of Atlas access. Missing private access fails the Atlas job explicitly, never skips it into green status.

The default Foundry `GITHUB_TOKEN` does not grant read access to another private repository. If no existing runner access is available, a user must supply **Foundry's** repository Actions secret `CRAFTATLAS_READ_TOKEN` using an authorized fine-grained token limited to **SOL3675/CraftAtlas**, **Contents: read** and automatic metadata read. No write, workflow administration or extra repository permissions are needed. Register it at Foundry Settings → Secrets and variables → Actions → Repository secrets, then rerun the failed workflow for the same SHA. Atlas's `CRAFTFOUNDRY_READ_TOKEN` is the reverse direction and cannot substitute. Do not copy cloud credentials or expose secrets to fork PRs.

The workflow uses that existing secret only for a pinned checkout with `persist-credentials: false`, then initializes the gitlink using a command-local local-source override and restores the canonical remote. It never installs Atlas's parent dependency or alters Atlas main. For an authorized local checkout at the pinned SHA, `node .github/scripts/prepare-atlas.mjs --source <checkout>` follows the same path. Full Atlas consumer validation can separately run its `prepare-foundry.mjs --source ../..`, frozen pnpm install, check/test/build; it keeps Atlas's independent Foundry pin and does not consume Foundry dev automatically.


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

`--atlas-source` is a development override only and is recorded with the full clean checkout commit in evidence. Without it the CLI still verifies a clean checkout at the exact recorded gitlink. Definition suites require contract v2; the merged pin supplies it for all four targets. Root install/build/pack still does not install or ship Atlas.

The Windows/Ubuntu Atlas integration CI runs all three integration checks and both representative suites through the default pinned path. Definition regressions exercise datapack overrides, unknown serializers, source-only/script-removed and runtime-only paths, explicit execution review and raw provenance for all four targets. For future definition contract updates, publish the reviewed Atlas commit first, update Foundry's gitlink to its final reachable SHA, then deliver Foundry. Re-run all three Atlas integration checks without the source override after each pin update. If Atlas is squash-merged, use the resulting remote SHA. Keep Atlas's independent Foundry package pin and lockfile unchanged. Publishing, PR changes and pin delivery require separate user authorization.

## Validate a new Foundry package locally

The Atlas pin is the reviewed remote merge of PR #6 (`817de1959b23c5dad8a250e7be56afcf64c68717`). Its recorded real-game run used implementation `5e2a7219d30a4e4fa0dd297cc2b1df6304a3b47e`: 15 required suites / 50 cases and 120 offline tests. That evidence validates Atlas with its independently pinned Foundry 0.1.5 (`21a7a3d4984eaa154b1c5a8b8d0a2756dfee05c6`); it does not validate a newer Foundry package. Keep the Atlas source pin and lockfile unchanged in this repository.

On a local validation machine, first restore the committed Foundry candidate and its actual gitlink, then run `npm ci --ignore-scripts`, all three Atlas integration checks above, `npm run check` and `npm pack`. Use a separate disposable checkout of Atlas at that exact merged SHA for candidate package validation. Bootstrap/install its original immutable dependency first, then copy the candidate tarball into its ignored `.harness/vendor/` and run `pnpm add -D craft-foundry@file:./.harness/vendor/craft-foundry-0.1.6.tgz --ignore-scripts` there. This explicit disposable consumer overlay changes only that checkout's manifest/lock; do not update the canonical Atlas source pin, commit the overlay or rerun bootstrap over the candidate. Record candidate Foundry commit, package SHA-256, the consumer overlay and original dependency identity with the Run.

Use actual absolute `java17` and `java21` homes, existing EULA acceptance, mc-pilot 0.15.0 and the verified locked tools in ignored local configuration. Follow Atlas's [development procedures](https://github.com/SOL3675/CraftAtlas/blob/main/docs/development.md#forge-and-fabric-1201-validation), including the 1.21.1 pack-fetch prerequisites. Run:

```console
pnpm check
pnpm test
pnpm build
pnpm exec mch doctor --json
pnpm exec mch inspect --target forge-1.20.1 --json
pnpm exec mch build --target forge-1.20.1 --json
pnpm exec mch inspect --target fabric-1.20.1 --json
pnpm exec mch build --target fabric-1.20.1 --json
pnpm exec mch inspect --target neoforge-1.21.1 --json
pnpm exec mch build --target neoforge-1.21.1 --json
pnpm exec mch inspect --target fabric-1.21.1 --json
pnpm exec mch build --target fabric-1.21.1 --json
pnpm exec mch test --all --profile release --json
```

Require all 15 suites / 50 cases, including each 1.20.1 seven-case world suite and its integrated JEI/EMI checks. Repeat both 1.20.1 viewer suites with `CRAFTATLAS_OBSERVATION_PERMISSION=denied` in newly created disposable worlds, following Atlas's permission procedure. Verify denied commands attach zero observations; normal runs verify actual player UUID/luck, tool NBT, damage context, matching fresh generation and unchanged inventory/block/entity state. Preserve raw captures, manifests/completion, current distribution/dependency hashes, logs and failed attempts. A prior Atlas pass cannot substitute for these candidate runs.

Finally collect a completed capture from the consuming Mod's actual candidate-built distribution and invoke this Foundry checkout's `atlas-survival.mjs` through its required process suite. Finite/unknown coverage must produce unsupported required cases; do not prune raw observations or incomplete datasets to force a green survival result. Rerun Foundry's own four-target fixture release profile for harness runtime changes. Missing Java/display/backend/access remains a validation blocker; an offline pass establishes only saved-data contracts.
