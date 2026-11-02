# Plan and report scoped validation

Copy the following sections into the project's normal task/PR/issue record. This is a human-readable template, not a new CLI command, mandatory file layout or machine result schema. Complete the plan and obtain human confirmation before implementation. Update the result after the approved checks; material scope changes need agreement before proceeding.

## Plan

- Change and intended behavior:
- Affected targets, features, integrations and persistence fields:
- Supported-save expectations, or agreed prerelease/new-save break:
- AI checks: concrete behavior/command, target, expected result and evidence needed for current validation/review, including any explicit retention requirement. Normally cover build/logic, feature functionality and essential affected item/data integrity.
- Human checks: detailed GUI interactions, play feel, balance and other agreed judgments; identify the reviewer when known.
- Out of scope / untested: behavior, targets and combinations, with the reason or impact.
- Required automated release suites and separate human release criteria, if this task concerns release:
- Human confirmation: who/when or a link to the confirming message; record any scope amendments.

Do not automatically populate every possible check. Choose relevant Modpack combinations around changed optional integrations. For item GUIs, plan native slot/server ownership checks; humans normally cover detailed clicking/dragging, Shift-click, cursor/close and usability. Agree essential item-loss regressions that AI should verify. For changed persistent state, decide whether a representative clean save/restart/restore is essential. Documentation-only work needs no Minecraft launch.

Approved specification changes may update or remove checks for behavior no longer in scope; record the scope amendment in the existing task record. Do not remove checks merely to hide failures. Evidence made obsolete by that change, or from a completed failed attempt no longer needed for current investigation, validation or review, may be deleted under [evidence retention and disposal](../../docs/storage.md#evidence-retention-and-disposal). A fix or passing rerun is not required solely to permit disposal. Keep active/in-use data, explicitly retained evidence and all references of any retained report; failure alone does not require extra approval for authorized in-scope cleanup.

## Result

| Planned check | Owner | Outcome | Evidence / remaining action |
| --- | --- | --- | --- |
| Build/logic or feature check | AI | Record actual pass, failure or environment/unsupported outcome | Command, target, revision/artifact identity and report/log path |
| Detailed GUI/play review, if planned | Human | Pending until performed | Reviewer and checklist; later record actual observations |
| Explicitly omitted behavior/target | Neither in this task | Untested / out of scope | Reason and practical limitation |

- Deviations from the confirmed plan and any new human agreement:
- Known failures, unsupported cases and environment blockers:
- Delivery state and human review still pending:

Human-pending is not failure and does not trigger exhaustive automation. Do not claim a human pass from scripted activity. Do not relabel an actual failed required automated check as pending review. Keep machine JSON/JUnit truthful: `passed`, `failed`, `unsupported`, `skipped` and `infrastructure-error` retain their existing meanings. This document supplements those results without adding statuses to their schema. A passing automated Run is scoped evidence, not automatic release approval.

See [development policy](../../docs/development.md), [configuration](../../docs/configuration.md) and [Minecraft basics](../../skills/minecraft-development-basics/SKILL.md).
