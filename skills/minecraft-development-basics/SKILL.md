---
name: minecraft-development-basics
description: Choose native Minecraft mechanisms when implementing or reviewing mod inventories, logical sides, registration, resources and saved state; check APIs against the selected version and mappings.
---

Use the selected target's resolved sources and mappings before naming APIs. In a Foundry project, use `mch inspect --target <id> --json`; elsewhere inspect the project's resolved development sources. The class names below are examples for 1.21.1, not universal names or a reason to retest every supported version after every edit. Agree AI checks, human checks and untested scope before implementation; minimum checks below are planning inputs, not an automatic full test matrix.

## Item manipulation GUIs

- **Applies:** Screens that move real ItemStacks, including a machine inventory or the player's inventory. Inherit vanilla container/menu and screen classes and use slots and their synchronization instead of implementing inventory clicks from scratch.
- **Reason:** Native menus provide the server/client slot protocol and standard interaction behavior. The logical server owns inventory changes; clients request actions and display synchronized state.
- **Version examples:** NeoForge 1.21.1 uses `AbstractContainerMenu` with `AbstractContainerScreen`. Fabric/Yarn 1.21.1+build.3 uses `ScreenHandler` with `HandledScreen`. Check constructors, registration and overrides in the resolved target sources.
- **Still implement:** Slot placement and insertion/extraction limits, quick-move/Shift-click routing, server validation of custom actions, and correct carried/cursor-stack and close handling. Review inherited behavior before overriding it; inheritance alone does not prove item conservation or persistence.
- **Exception:** Display-only and configuration screens without item manipulation can use ordinary screens. A recipe display of item icons alone does not require an inventory container.
- **Minimum check:** AI reviews the slot model, server ownership and affected transfer logic, then checks representative functionality/item conservation within the approved scope. Detailed clicking, dragging, hotbar shortcuts, full inventory, cursor/close interactions and play feel default to human checks; agree any essential item-loss regression that AI must verify explicitly. Human-pending work does not trigger exhaustive GUI automation.

## Logical sides

- **Applies/reason:** Mutate gameplay state on the logical server; keep rendering and client-only classes out of common/server initialization. This avoids duplicate actions and dedicated-server classloading failures.
- **Exception:** Client predictions and visual effects may be local, with authoritative results reconciled from the server.
- **Minimum check:** Trace the affected call/packet path and validate inputs server-side. Select a dedicated-server check when changed classloading or behavior warrants it; do not add a side matrix to an unrelated documentation change.

## Registries and namespaced IDs

- **Applies/reason:** Register content through the target loader's supported lifecycle and use stable namespaced IDs for content, resources and saved references. An instance's mutable state belongs to that instance, not a registry singleton.
- **Exception:** Ordinary transient Java objects need no registry. During an agreed prerelease/new-save break, IDs may change with the impact documented.
- **Minimum check:** Confirm affected registration and resource references agree. For an existing-save contract, check only the affected saved references; do not invent a general migration framework.

## Data and resources

- **Applies/reason:** Prefer recipes, tags, loot tables, models, translations and other supported data/resource mechanisms over duplicate Java rules, so normal datapack/resource-pack overrides remain usable.
- **Exception:** Behavior outside the target's supported data mechanisms can use code; custom serializers need explicit semantics.
- **Minimum check:** Inspect the effective affected resource and registration/reload behavior when relevant. Resource presence or a viewer entry alone does not prove execution. Version-specific paths such as 1.21.1 `recipe` versus 1.20.1 `recipes` must be checked, not generalized.

## Persistence and synchronization

- **Applies/reason:** Store per-block/entity/item/world state using the appropriate native persistence mechanism for that owner and version. Saving and network synchronization are separate responsibilities; a synchronized screen value is not proof of saved state.
- **Exception:** Derived or transient display state need not be saved. Agreed prerelease/new-save breaks can omit migration for discarded save formats.
- **Minimum check:** Review dirty/save hooks and the affected serialization fields. When an essential affected persistence contract needs runtime proof, plan a representative clean save/restart/restore check. Reconnection and a serialization roundtrip alone do not prove restart restoration. Avoid testing unrelated persistent systems on every change.

## Maintain these lessons

Add a lesson only when it changes a reusable development decision. Record applicability, reason, exceptions and the smallest useful check, with version/source evidence where API-specific. Keep one-off bugs scoped; a discovered issue does not automatically justify a blanket rule, compatibility ban, new framework or publication/deployment.

Sources: [NeoForge 1.21.1 menus](https://docs.neoforged.net/docs/1.21.1/gui/menus/), [screens](https://docs.neoforged.net/docs/1.21.1/gui/screens/), and [Yarn 1.21.1+build.3 ScreenHandler](https://maven.fabricmc.net/docs/yarn-1.21.1%2Bbuild.3/net/minecraft/screen/ScreenHandler.html).
