# Legacy target research — 2026-09-30

These are pinned port candidates, not real-game passes. Fabric implementation begins separately after NeoForge 1.21.1's build/GameTest acceptance.

## Exact candidates and Java roles

| Target | Minecraft | Loader/build pins | Gradle JVM | Compilation | Game JVM |
| --- | --- | --- | --- | --- | --- |
| Fabric | 1.20.1 | Loader 0.16.14; API 0.92.7+1.20.1; Yarn 1.20.1+build.10; Loom 1.8.13; Wrapper 8.10 | Java 21 | Java 17, `--release 17` | Java 17 |
| Forge | 1.20.1 | Forge 47.3.0; ForgeGradle candidate 6.0.36; official MDK Wrapper 8.8; official mappings 1.20.1 | Java 21 candidate | Java 17, `--release 17` | Java 17 |

The Minecraft 1.20.1 version JSON declares Java runtime gamma / major 17. Gradle's Java 21 runtime support starts at 8.5, so both Wrapper choices support the independent Gradle-Java role. This is a Gradle compatibility conclusion, not a ForgeGradle build pass. The exact ForgeGradle 6.0.36 POM is published; the official Forge 47.3.0 MDK specifies the dynamic range `[6.0,6.2)`, which must be replaced by an explicit plugin pin and dependency lock. Its actual Wrapper is 8.8 and toolchain is 17. Do not infer a ForgeGradle version from the Minecraft/game-Java version.

Windows currently has `C:/Program Files/Java/graalvm-jdk-17.0.10+11.1` and `graalvm-jdk-21.0.5+9.1` available. The roots remain in ignored local configuration; shared target configuration uses role keys.

Official references: [Gradle compatibility](https://docs.gradle.org/current/userguide/compatibility.html), [Fabric API 0.92.7 repository](https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.92.7+1.20.1/), [Yarn 1.20.1 metadata](https://meta.fabricmc.net/v2/versions/yarn/1.20.1), [Forge Java requirements](https://docs.minecraftforge.net/en/1.20.1/gettingstarted/), [exact ForgeGradle POM](https://maven.minecraftforge.net/net/minecraftforge/gradle/ForgeGradle/6.0.36/ForgeGradle-6.0.36.pom), [official 47.3.0 MDK](https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-mdk.zip).

Downloaded MDK SHA256: `208a25b903951ed3acfceeaf1b53124db45ba71e86a0f57d309ac5b3a4db7642`. Fabric API official JAR SHA256: `d5e7750a599ee23d1e8ce1716f27c4761f4e7a84e8a08d5eb8f0ad8c155c8cb1`.

## Port differences

Fabric's 1.20.1 block use callback includes `Hand`; 1.21.1 no-item `onUse` differs. Block entity NBT methods in 1.20.1 do not take the later registry lookup parameter. The 1.20.1 block base does not require the later block codec override. GUI property delegates remain suitable for the counter. Fabric client command v2 can still expose an observational local readout. Resource paths for loot tables and GameTest structures are plural in 1.20.1, unlike later singular paths. Existing pure state logic uses Java 21 `Math.clamp`; use equivalent bounded Java 17 operations for this port.

Forge uses Mojang names (`BlockEntity`, `AbstractContainerMenu`, `ContainerData`, `MenuType`, `MenuScreens`) and Forge registration/events. The 1.20.1 block entity save/load methods operate on `CompoundTag` without the later registry provider. `Block#use` has the hand argument. Register operator server observations via `RegisterCommandsEvent`; use Forge client command events for client observations. GameTest registration uses static methods with `@GameTest`, `@GameTestHolder` or the mod-bus `RegisterGameTestsEvent`, and an explicit `fixture` namespace. Put the empty NBT structure under `data/fixture/structures`, disable class prefixing where needed, and declare expected cases/minimum counts.

The official Mojang server mappings for **1.20.1** identify the reporter as `net.minecraft.gametest.framework.JUnitLikeTestReporter(File)` and `GlobalTestReporter.replaceWith(TestReporter)`. It is not named `JUnitTestReporter` in these mappings. Configure this reporter explicitly at test registration/initialization and allow server completion to flush the XML; the exact integration still requires real execution. The official MDK supplies a `gameTestServer` run and `forge.enabledGameTestNamespaces` property. See [version-specific Forge GameTests](https://docs.minecraftforge.net/en/1.20.1/misc/gametest/) and the [exact Forge sources JAR](https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-sources.jar).

## mc-pilot alignment

Published npm 0.15.0's inspected `data/variants.json` declares Fabric 1.20.1 Loader 0.16.14 / Yarn build.10 / Java 17, and Forge 1.20.1 Forge 47.3.0 / Java 17. Its Forge validation is `limited`. These catalog claims are not harness verification. Both helper artifacts from the fixed hosting release v0.14.0 were downloaded and their bytes matched GitHub's SHA256 digest:

| Helper | URL | SHA256 |
| --- | --- | --- |
| Fabric 1.20.1 | [fixed release artifact](https://github.com/kzheart/mc-pilot/releases/download/v0.14.0/mct-client-mod-fabric-1.20.1.jar) | `7c97e1087f9e222513eaa80317fd01245be352be0826c1461061634ee13f9756` |
| Forge 1.20.1 | [fixed release artifact](https://github.com/kzheart/mc-pilot/releases/download/v0.14.0/mct-client-mod-forge-1.20.1.jar) | `b93ce00ef658a2ac96ae763cbf873772ae912f0ce728a9740b70e3c85ab2bcd9` |

Files are in ignored `.harness/tools/legacy-research`. Keep separate helper pins per Minecraft/loader target and pass the explicit helper artifact to the existing broker. The current product installer is intentionally fixed to the verified Fabric 1.21.1 helper. Do not silently reuse that helper for these targets. Forge server installation must use the same 47.3.0 loader as the fixture/client catalog.

## Build-root choice and Linux prerequisites

Use independent roots for Fabric 1.20.1 and Forge 1.20.1. Their Java APIs, NBT/resource layouts, mappings and build plugins already differ from the 1.21.1 roots. Share pure Java logic later, after the ports demonstrate the actual common boundary. Stonecutter has not been executed here; no claimed Stonecutter compatibility or source-switching benefit supports adding it yet. If later adopted for small differences within a loader/version family, preserve root locks because source switching mutates the working tree.

Read-only WSL inspection found Ubuntu-24.04 (WSL 2) installed, initially stopped. Inside that distro, `java`, `node`, `Xvfb`, and `glxinfo` are not on PATH, and `/usr/lib/jvm` has no listed installations. This is an environment gap, not a Minecraft failure. No Linux packages or Java installations were changed. Future Linux work needs explicit Java 17/21, Node 24, and display/OpenGL prerequisites before game verification.
