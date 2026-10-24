# Practical Mod development

## Agree validation ownership before implementation

Write a short change plan using the [plan/result template](../templates/validation/README.md). List affected features/targets, AI checks, human checks and out-of-scope or untested behavior. Obtain human confirmation of that division before implementation. Keep the approved scope through routine work; surface material new decisions instead of silently expanding automation or adding product restrictions.

AI normally checks build/logic, whether the implemented feature works, and essential affected item/data persistence. Detailed GUI interactions, play feel and balance default to human checks. Choose relevant Modpack combinations around changed integration boundaries and known risks rather than every combination. Documentation and guidance changes do not require Minecraft runs.

Report machine outcomes, human-pending checks and untested scope separately. Human-pending is not a failure and must not trigger exhaustive automation. A machine pass proves only the checks actually performed. Keep actual failures, unsupported/skipped required cases, zero detections and unstable attempts truthful; never replace them with a manual-pending label. Do not drop required suites just to pass. A release Run and human release criteria are distinct parts of the agreed decision.

Use `requiredSuites` for agreed automated release requirements; use `--suite` for scoped development checks. A pending human check belongs in the plan/result document, not a fake case in JSON/JUnit. Existing result/config schemas and exit codes remain unchanged. The packaged fixture matrix is the harness's regression contract, not a universal minimum for every Mod or every edit.

## Prefer native mechanisms

Use the [Minecraft development basics Skill](../skills/minecraft-development-basics/SKILL.md) for inventory menus/screens, logical sides, registries/IDs, data/resources and per-instance state. Check class names and behavior against the selected target's resolved sources and mappings. Native mechanisms reduce duplicated protocol/lifecycle logic, but inherited behavior still needs the feature's slot constraints, quick-move routing and item/data ownership implemented correctly.

Persist state at its proper owner and keep persistence separate from synchronization. Select representative checks for affected saved fields. When proving clean restart restoration, follow [persistence](persistence.md); a reconnect or serialization roundtrip cannot establish that claim. Do not rerun unrelated persistence after every change. An agreed prerelease/new-save break can discard old formats; avoid speculative migration or recovery frameworks without an actual supported-save requirement.

## Separate build pins from runtime compatibility

Pin development Minecraft, loader, mappings, plugins and dependencies for reproducible builds. Runtime Mod metadata serves a different purpose: normally accept the development loader/Fabric API version and newer. Set Minecraft's compatibility range separately based on the intended target; do not broaden it just because the loader range is open. A declared range is not evidence that every included combination was tested.

For example, a Fabric project developed with Loader 0.16.14 and Fabric API 0.116.1+1.21.1 can declare these runtime constraints while keeping exact build dependencies:

```json
{
  "depends": {
    "fabricloader": ">=0.16.14",
    "fabric-api": ">=0.116.1+1.21.1",
    "minecraft": "1.21.1"
  }
}
```

This is an illustrative policy example, not a new supported/tested combination. Preserve the project's actual dependency IDs and versions. In NeoForge metadata, `loaderVersion="[1,)"` describes the language loader; the `[[dependencies.<modid>]]` entry for `modId="neoforge"` declares the NeoForge runtime dependency, for example `versionRange="[21.1.252,)"` for that development version. Minecraft uses its own dependency/range. Do not confuse either metadata field with the harness artifact manifest's resolved `loaderVersion`.

Exclude a known incompatible version/range with concrete evidence and a reason. Unknown compatibility is not incompatibility. Consult the human before compatibility narrowing or restrictive startup/interaction behavior. See the [NeoForge 1.21.1 metadata reference](https://docs.neoforged.net/docs/1.21.1/gettingstarted/modfiles/) and [Fabric metadata specification](https://wiki.fabricmc.net/documentation:fabric_mod_json_spec) for exact syntax and dependency semantics.

## Support ordinary environment changes

Mod/config/datapack additions, updates and removals are ordinary operation. Prefer supported overrides, reload/lifecycle mechanisms and local handling of unavailable optional integrations. Preserve item/data integrity without freezing entire environments/files. Optional integration failures should disable or degrade the affected integration rather than unrelated gameplay; required dependencies still need accurate declarations and actionable errors.

Diagnose concrete issues with affected IDs/versions, relevant logs and a useful next action. Do not hide a failure with silent data loss. Before adding a restrictive startup refusal, interaction restriction or compatibility ban, explain the demonstrated integrity issue and discuss the smallest practical response with the human.

Use [acquisition analysis](survival.md) only when relevant to an agreed question. Effective resources and viewer entries are evidence, not proof of execution or exhaustive coverage. Unknown hooks stay unknown, with actionable next steps; unavailable Atlas tooling does not universally block normal Mod work. Once selected as required, the suite's current-build identity and evidence rules still apply.

## Keep harness protections in the harness

Preserve owned-process lifecycle, isolated worlds, hashes, scoped evidence and consumer customizations. [Storage](storage.md) controls protect validation data and processes; do not transplant cache/evidence immutability into player-facing startup or interaction restrictions. [Skill installation](skills.md) preserves edited consumer files; inspect them before adopting updated guidance. New reusable lessons need applicability, reason, exception and a minimum check, not a blanket rule inferred from one bug. Publication, consumer deployment and release are separate authorized actions.
