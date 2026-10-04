# Author a Mod acquisition definition

Use this opt-in template only with the repository-only [Foundry survival suite](../../docs/survival.md). It is a fictional 1.21.1 NeoForge example, not a supported real Mod adapter. Change all IDs, exact target versions and verification evidence after inspecting your Mod and its current Atlas capture. For Fabric use its own exact target/version pack. Do not widen support to other versions.

`definitions.json` shows two extension points: replace the interpretation of one captured custom serializer, and add a material-consuming code acquisition process. AND input slots, OR alternatives, captured tags, requirements and unknowns keep their Atlas meaning. Unverified machine power, Java hooks, predicates or custom constraints must remain opaque/unknown. The definition does not change the game.

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
npm run test:atlas:definitions -- --atlas-source ../CraftAtlas
node scripts/atlas-survival.mjs --config tests/atlas-definitions/fixtures/suite.json --results .harness/custom/results.json --atlas-source ../CraftAtlas
```

The fixture and tests are repository-only; they are not included in the installed npm harness. After the upgraded Atlas commit is published and pinned, omit the local source option and require `test:atlas:definitions` in CI. Missing upgrade/access/coverage is a failure, not a substitute success. See the [survival guide](../../docs/survival.md) for process runtime configuration, supported targets and evidence limits.
