# Shared fixture logic

`CounterState` and its two JUnit tests contain no Minecraft or loader APIs. Each independent fixture applies `shared-sources.gradle` and compiles this Java 17 compatible source with its own Java toolchain. Loader registration, block entity persistence, networking, screens, commands, and GameTest code stay in each loader build root.

The exporter depends on `copySharedInspectionSources` and publishes `build/harness/shared-sources/main/java` in its source metadata. This exact source snapshot stays within the inspected build root, preserving manifest path containment while showing all compiled fixture logic.
