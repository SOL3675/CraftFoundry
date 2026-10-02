# NeoForge 1.21.1 実装根拠と検証記録

2026-09-30。フェーズ 2 の Fabric 実ゲーム受け入れ後、独立した `fixtures/neoforge-1.21.1` を作成した。参考にした一次資料は次の固定コミットとバージョン別公式ドキュメント。

- [NeoForge 公式 1.21.1 ModDevGradle MDK](https://github.com/NeoForgeMDKs/MDK-1.21.1-ModDevGradle/tree/7819b902a351b03fe71db00754d103b5a31c4ebf)。実際に workspace 内へ clone して内容を確認。
- [NeoForge 1.21.1 ソース](https://github.com/neoforged/NeoForge/tree/61045a61fca76876999281676a9e794688390a9e)。GameTest 起動フラグ、イベント、クライアント専用登録の実コードを確認。
- [ModDevGradle ソース](https://github.com/neoforged/ModDevGradle/tree/e9c127db51cd59d8d19e238af6a01e071d769661)。RunModel/source set と解決依存構成を確認。これは調査用 main の固定コミットであり、2.0.148 そのもののタグと同一とは主張しない。実ビルドは Maven の 2.0.148 を使用。
- [NeoForge 1.21.1 開発要件](https://docs.neoforged.net/docs/1.21.1/gettingstarted/)、[GameTest](https://docs.neoforged.net/docs/1.21.1/misc/gametest/)、[Block Entity](https://docs.neoforged.net/docs/1.21.1/blockentities/)、[Menu](https://docs.neoforged.net/docs/1.21.1/gui/menus/)、[Screen](https://docs.neoforged.net/docs/1.21.1/gui/screens/)。

## 固定値

| 部品 | 固定値・実際の確認 |
| --- | --- |
| Minecraft | 1.21.1。解決済み `net.neoforged:minecraft-dependencies:1.21.1` を manifest に出力 |
| NeoForge | 21.1.252。公式 MDK が宣言。実解決した `net.neoforged:neoforge` から export |
| ModDevGradle | 2.0.148。公式 MDK と同じ plugins 宣言 |
| Gradle | 9.2.1。公式 MDK と同じ distribution。Java 21 で実行成功 |
| Java | Gradle / toolchain / game は 21。今回の端末は GraalVM JDK 21.0.5+9.1 |
| mappings | Mojang 1.21.1。MDK の任意 Parchment は採用せず、追加依存を避けた |
| NeoForm | lockfile に `1.21.1-20240808.144430`、runtime `2.0.31` を記録 |
| JUnit | Jupiter 5.11.4 / platform launcher 1.11.4 |

[Gradle 9.2.1 distribution SHA-256](https://services.gradle.org/distributions/gradle-9.2.1-bin.zip.sha256): `72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`。

[Gradle 9.2.1 wrapper JAR](https://raw.githubusercontent.com/gradle/gradle/v9.2.1/gradle/wrapper/gradle-wrapper.jar) は [公式 SHA-256](https://services.gradle.org/distributions/gradle-9.2.1-wrapper.jar.sha256) の `423cb469ccc0ecc31f0e4e1c309976198ccb734cdcbb7029d4bda0f18f57e8d9` と照合した。MDK に含まれていた wrapper JAR はこの版の SHA と異なったため、公式 9.2.1 JAR に置き換えた。ライセンスを fixture 内へ添付。

## Fabric からの差分

| Fabric / Yarn | NeoForge / Mojang |
| --- | --- |
| `ScreenHandler`, `PropertyDelegate` | `AbstractContainerMenu`, `ContainerData` / `SimpleContainerData`, `addDataSlots` |
| `HandledScreen`, `DrawContext` | `AbstractContainerScreen`, `GuiGraphics` |
| `NamedScreenHandlerFactory` | `MenuProvider` と server player の `openMenu` |
| NBT `readNbt` / `writeNbt` | `loadAdditional` / `saveAdditional(CompoundTag, HolderLookup.Provider)` |
| Block Entity update packet | `ClientboundBlockEntityDataPacket.create(this)`、initial chunk の `getUpdateTag` |
| Fabric 登録 / client initializer | `DeferredRegister`、`Dist.CLIENT` 限定 `EventBusSubscriber` |
| client command callback | `RegisterClientCommandsEvent`。状態を読むだけのコマンド |
| `remapJar` 配布成果物 | Mojang mappings の通常 `jar`。開発クラスパスを配布試験へ流用しない |

ゲーム非依存の CounterState と単体テスト、fixture の自作モデル資源は Fabric fixture から同じ MIT 条件で移植。Block Entity 更新と Menu の整数同期は別々に保持。client 専用 import は client class に隔離し、専用サーバーで実ロードできることを確認した。

## 実 GameTest と JUnit

ModDevGradle の `gameTestServer` run、`neoforge.enabledGameTestNamespaces=fixture` を使用。NeoForge ソースで `neoforge.gameTestServer` を確認。XML 出力は Fabric API の report-file フラグを流用せず、test-only Mod が `ServerAboutToStartEvent` で vanilla `GlobalTestReporter.replaceWith(new JUnitLikeTestReporter(file))` を設定する。出力先は build 内の明示した `mch.fixture.reportFile`。

主 Mod とテスト Mod を同じ Java パッケージへ置くと JPMS の split package で起動に失敗したため、test-only Mod は `dev.mch.fixture.gametest` に分離した。jar tf で production JAR にこの package、helper TOML、test structure が含まれないことを確認した。

GameTest raw ID `fixture:empty.counter_initial` / `fixture:empty.counter_persistence` を target の `caseAliases` で共通 ID `fixture.counter_initial` / `fixture.counter_persistence` に変換する。XML の `classname` はテンプレート `fixture:empty`、`name` はテストメソッド。

## 検証した結果

Java 21 と fixture 専用 `GRADLE_USER_HOME=.harness/cache/gradle` で `gradlew.bat --no-daemon --console=plain build harnessExport harnessServerGameTest --write-locks` が成功。通常 JUnit 2 件、実 Minecraft GameTest 2 件とも失敗・エラー 0。実サーバーログは `All 2 required tests passed :)` とワールド保存・停止を記録。XML timestamp は `2026-09-30T08:47:58.379930300Z`。

配布 JAR は `harness-fixture-neoforge-0.1.0.jar`、18,123 bytes、SHA-256 `3d8466c2b8ea879fe9ef9b14a6ff9357f2efbe228c96e1aa9b91447c3ffd477f`。fixture が必要とする追加 runtime Mod はない。NeoForge 自体の導入は runtime adapter の installer と固定 tool hash で別管理する。

実際の Fabric と NeoForge の重複から `templates/gradle/harness-export.gradle` を作成した。loader 特有の解決 API と production artifact の選択は build.gradle 側の Closure に残し、JSON 出力・manifest 契約・path containment・重複・通常ファイル・Minecraft 宣言一致を共有。両 fixture の `harnessExport` と AJV manifest 検証が成功した。NeoForge へ宣言のみ `-Pminecraft_version=1.21.2` を渡す負例は、解決済み 1.21.1 との不一致で export 失敗を確認した。

この記録時点では NeoForge production JAR の dedicated/client/multiplayer 起動と同期は runtime 担当に引き継いだ段階。開発用 GameTest の成功を production multiplayer 成功へ拡張して解釈しない。
