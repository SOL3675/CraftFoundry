# Author a Mod acquisition definition

Use this opt-in template only with the repository-only [Foundry survival suite](../../docs/survival.md). It is a fictional 1.21.1 NeoForge example, not a supported real Mod adapter. Change all IDs, exact target versions and verification evidence after inspecting your Mod and its current Atlas capture. Use separate exact target/version packs for Fabric/NeoForge 1.21.1 and Forge/Fabric 1.20.1. The example stays pinned to NeoForge 1.21.1; change its `targets` and evidence explicitly for another supported target. Do not widen support to other versions.

`definitions.json` shows two extension points: replace the interpretation of one captured custom serializer, and add a material-consuming code acquisition process. AND input slots, OR alternatives, captured tags, requirements and unknowns keep their Atlas meaning. Unverified machine power, Java hooks, predicates or custom constraints must remain opaque/unknown. The definition does not change the game.

## Inspect active datapack evidence first

Build the Mod, load that distribution with the intended server packs/configuration, wait for startup/reload completion, and run `craftatlas dump <new-label>` from the server console (or `/craftatlas dump <new-label>` in game). Keep the completed capture, including `datapack.json`, manifest and completion, with the Run. Commands below run from the Atlas checkout and accept either a snapshot JSON or a completed capture directory:

```console
pnpm atlas datapack --snapshot <capture> --limit 100 --offset 0 --json
pnpm atlas datapack yourmod:recipe/press.json --snapshot <capture> --json
pnpm atlas inspect yourmod:press --snapshot <capture> --json
pnpm atlas coverage --snapshot <capture> --json
pnpm atlas diff --before <before-capture> --after <after-capture> --json
```

For either 1.20.1 target, query `pnpm atlas datapack yourmod:recipes/press.json --snapshot <capture> --json` instead. Do not guess a singular/plural convention for other Minecraft versions. 1.20.1 recipe results use the target's item/NBT and network serializer APIs; a 1.21.1 codec or component layout is not interchangeable.

Read all relevant pages (`resources.total`/`truncated`; increase `--offset`). Inspect `effective.text`, `effective.data`, `effective.sha256`, `effective.source` and `stack` in visible low-to-high order, along with capture session/generation and exact installed Mod versions. Review the effective variant against RecipeManager data; lower variants are provenance, not extra processes. `selectedPacks`, `loadedPacks` and `disabledPacks` are distinct IDs, not inferred authorship. Raw changes in a diff do not by themselves prove changed runtime behavior. CLI exit 0 means a completed query; inspect statuses and diagnostics.

All four supported targets capture active server resources independently of JEI/EMI. To include a separate server JSON directory, add `-Dcraftatlas.resourceDirectories=machines,yourmod/acquisition` to the actual game JVM before startup. These are paths below `data/<namespace>/`; `recipe` is always captured on 1.21.1 and `recipes` on 1.20.1. Only JSON in those directories is included; disabled-pack contents and client assets are excluded. Older captures report `captured: false`, which is missing evidence, not proof of no resources.

## Review finite observations and viewers

Both 1.20.1 collectors support bounded `craftatlas observe loot/block/entity/world`; use Atlas's [usage guide](https://github.com/SOL3675/CraftAtlas/blob/main/docs/usage.md) for exact command arguments. Wait for completion, then make a dump in the matching session/generation. Keep observation JSON, manifests, seeds, tool NBT, player/luck/damage context and chunk/height bounds with the Run. Finite samples stay partial even when all requested trials complete; they never establish exhaustive absence, sustainable supply or progression. They do not perform real break/death events or prove arbitrary hooks. Command-registration coverage does not upgrade finite-sample coverage.

JEI/EMI records preserve unique viewer entry IDs, backing recipe IDs, quantities and session/generation. They do not prove execution or probabilities. Forge fluid runtime behavior remains unverified. Foundry saves raw recipes/network bytes, viewer/world records and normalized observation evidence beside raw datapack provenance and overlay history. Unknown serializers, incomplete coverage, stale identities and unconfirmed execution must remain failures/unsupported.

## Review semantics and execution

A standard resource `yourmod:recipe/press.json` on 1.21.1 or `yourmod:recipes/press.json` on 1.20.1 maps to process `yourmod:press`; a custom-directory resource has no assumed recipe ID convention. Use an explicit definition addition for a reviewed custom API. Unknown serializers and standard JSON absent from RecipeManager (including condition-rejected or script-removed recipes) remain opaque/unconfirmed with no inferred outputs. A runtime-only record lacks source provenance and requires explicit execution review in this suite.

Before setting `interpretation: "supported"` and `execution: "executable"`, verify registration/custom API behavior, inputs, outputs, conditions, power, equipment and remaining costs against exact-version code and execution evidence. Use an explicit `replace` patch for scalar execution state; clearing `unknown` alone does not establish execution. Record the resource ID, effective source/hash, session/generation, source path and execution/test reference in `verified`/operation `evidence`. The fictional example's enabled power is an explicit scenario fact (`gameRules.lootContext.powered`), not an implementation of a Java power hook. Preserve an opaque requirement or unknown reason whenever the hook cannot be reviewed.

Overlays preserve raw JSON, datapack variants, field provenance and replacement history. Raw capture coverage cannot be promoted by definitions or external surveys. Custom-directory `datapackInterpretation` coverage remains unsupported even with an addition; report that blocker until reviewed Atlas support can resolve it. Malformed resources, source/runtime serializer conflicts and unreviewed runtime-only records also prevent a green Foundry suite. Do not remove them from a capture to obtain a pass.

Copy the pack into your Mod (for example `craftatlas/definitions.json`) and add paths and mechanism declarations to its survival suite:

```json
{
  "definitions": ["craftatlas/definitions.json"],
  "mechanisms": [
    { "id": "yourmod:press", "mod": "yourmod", "processes": ["yourmod:press"], "evidence": "Reviewed source path, exact version and test reference" }
  ],
  "cases": [
    { "id": "press.available", "item": "yourmod:product", "expected": "reachable" },
    { "id": "press.missing_material", "item": "yourmod:product", "expected": "unreachable", "without": ["yourmod:material"] }
  ]
}
```

This is a fragment, not a complete suite. Keep snapshot, target, scenario, actual provider evidence and the external-source surveys. Paths resolve relative to the suite file. `without` removes the named initial inventory/equipment/stage/dimension assumptions for that regression case; it does not forbid later acquisition. Supply a closed, reviewed scope to assert unreachable. Default production cases continue to require reachable; expected unreachable passes a regression assertion only.

Declare mechanisms implemented outside recipe enumeration, too. If a hook cannot be mapped, retain an entry with its proposed process IDs and `unknown` explaining the missing evidence. The runner will report unsupported and an actionable missing mapping/test diagnostic. Definitions require namespaced pack IDs, exact installed Mod targets and nonempty verification references. Never put a material-consuming transformation in `providers`.

From Foundry, exercise the complete representative fixture through real Atlas APIs and Foundry's process-suite evaluator:

```console
npm run check:atlas
npm run test:atlas
npm run test:atlas:definitions
node scripts/atlas-survival.mjs --config tests/atlas-definitions/fixtures/suite.json --results .harness/custom/results.json
```

The fixture and tests are repository-only; they are not included in the installed npm harness. The tracked submodule supplies the upgraded contract and CI requires `test:atlas:definitions`, including raw-resource, override and source-only regressions for all four targets. Inspect the result evidence's `datapack`, `resourceDiagnostics`, `definitionProcesses` (raw/provenance/history), original/effective coverage and definition hashes. Use `--atlas-source <clean-checkout>` only for explicit development of a future Atlas revision. Missing upgrade/access/coverage is a failure, not a substitute success. See the [survival guide](../../docs/survival.md) for process runtime configuration, supported targets and evidence limits.
