# Survival acquisition checks with CraftAtlas

This repository-only suite uses the pinned `projects/craft-atlas` submodule's actual snapshot reader, schema validator, normalizer, and reachability analyzer. It accepts an Atlas snapshot JSON or completed capture directory, including checksum/session/generation checks. It does not install Atlas, call its CLI's success exit an acquisition pass, or claim game validation from offline data. Root npm install/build/pack stays independent; the tool and submodule are not part of the npm consumer API.

The current common scope is **Minecraft 1.21.1 with Fabric or NeoForge**. Foundry's 1.20.1 and Forge targets, other Minecraft versions, and unsupported recipe adapters remain unsupported here. Expanding Atlas's game support is a later task. A saved capture must match the configured Minecraft/loader and the active harness target (including its declared loader version). Normalization uses Atlas's exact adapter/mod-version support and retains unsupported data.

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

`externalSources` must survey each of those six categories, with `complete`, `partial` or `unsupported` and an evidence reference. `complete` is the caller's reviewed assertion for the scenario's scope, not a proof the tool derives from absent loot tables or recipes. A reviewed category with no possible sources can be complete; unknown custom hooks must remain partial/unsupported. Source declarations do not replace, upgrade or delete Atlas capture/normalization coverage. Any incomplete capture/coverage/survey or unconfirmed provider makes the acquisition cases unsupported, even when a known recipe route exists. Missing surveys open the scenario before analysis, preventing an unsupported absence claim.

Within complete data, Atlas uses a qualitative least fixed point: all input slots are required, each slot may choose one alternative/tag member, and a cycle cannot create an initial supply. Negative results additionally require explicit closed resources covering the target and every dependency. Open domains produce unknown; unknown becomes a required harness failure. Nonzero loot probabilities prove possible acquisition, not guaranteed outcomes. Finite stock scheduling, exact components, enough fuel/durability, renewable world supply and arbitrary Mod code remain outside this initial suite. Preserve Atlas's diagnostics and limits when reviewing a result.

## Connect the existing harness process driver

Add a suite/runtime to the consuming Mod's `harness.config.json` and add `survival-acquisition` to the appropriate 1.21.1 Fabric/NeoForge target's `requiredSuites`. Use your actual Foundry checkout path in the runtime argument; the executable receives each argument separately, including Windows paths with spaces. Configuration paths belong to that Mod project; result paths belong to the isolated session:

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

[Atlas survival CI](../.github/workflows/atlas.yml) verifies the exact gitlink, initializes a real submodule and runs both common loaders' offline contracts on Windows/Ubuntu. Ordinary [Foundry contracts](../.github/workflows/contracts.yml) remain independent of Atlas access. Missing private access fails the Atlas job explicitly, never skips it into green status.

The default Foundry `GITHUB_TOKEN` does not grant read access to another private repository. If no existing runner access is available, a user must supply **Foundry's** repository Actions secret `CRAFTATLAS_READ_TOKEN` using an authorized fine-grained token limited to **SOL3675/CraftAtlas**, **Contents: read** and automatic metadata read. No write, workflow administration or extra repository permissions are needed. Register it at Foundry Settings → Secrets and variables → Actions → Repository secrets, then rerun the failed workflow for the same SHA. Atlas's `CRAFTFOUNDRY_READ_TOKEN` is the reverse direction and cannot substitute. Do not copy cloud credentials or expose secrets to fork PRs.

The workflow uses that existing secret only for a pinned checkout with `persist-credentials: false`, then initializes the gitlink using a command-local local-source override and restores the canonical remote. It never installs Atlas's parent dependency or alters Atlas main. For an authorized local checkout at the pinned SHA, `node .github/scripts/prepare-atlas.mjs --source <checkout>` follows the same path. Full Atlas consumer validation can separately run its `prepare-foundry.mjs --source ../..`, frozen pnpm install, check/test/build; it keeps Atlas's independent Foundry pin and does not consume Foundry dev automatically.
