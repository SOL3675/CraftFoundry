# Forge 1.20.1 fixture

`fixture:counter` の操作、永続化、Block Entity と GUI の同期、サーバーとクライアントの読み取り専用コマンドは 1.21.1 fixture と同じ仕様。ゲーム非依存の CounterState と単体テストは [共通 Java ソース](../common/README.md) を Java 17 でコンパイルする。

Minecraft 1.20.1、Forge 47.3.0、ForgeGradle 6.0.36、Gradle 8.8、Java 17 を固定している。[公式 47.3.0 MDK](https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-mdk.zip) の Gradle Wrapper 構成を使用し、ForgeGradle の動的範囲を固定版へ置き換えた。MDK SHA-256 は `208a25b903951ed3acfceeaf1b53124db45ba71e86a0f57d309ac5b3a4db7642`。Wrapper JAR は公式 Gradle 8.8 の SHA `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8` と照合して置換した。

```powershell
$env:JAVA_HOME = '端末の Java 17 home'
$env:GRADLE_USER_HOME = Join-Path $PWD '.harness/cache/gradle'
# EULA に同意済みの場合に限り指定する。
$env:MCH_EULA_ACCEPTED = 'true'
.\gradlew.bat --no-daemon --console=plain build harnessExport harnessServerGameTest
```

`MCH_EULA_ACCEPTED=true` のときに限り GameTest タスクが隔離した `build/gametest/eula.txt` へ同意を反映する。それ以外は通常の Minecraft の同意要求に従う。端末の Java home とハーネスの EULA 同意設定は無視対象の `harness.local.json` に置く。

`harnessExport` は [共有 exporter](../../templates/gradle/harness-export.gradle) を使い、**`reobfJar` 完了後**の `build/libs/harness-fixture-forge-0.1.0.jar` を明示する。ForgeGradle が付ける開発マッピングの `_mapped_official_...` 接尾辞は、解決済み依存から元の Minecraft・Forge 版を取得するときに除く。sources JAR や開発 classpath は配布しない。共通ソースの調査用 snapshot は `build/harness/shared-sources/main/java` に保存する。

`harnessUnit` は JUnit 2 件、`harnessServerGameTest` は実サーバーの GameTest 2 件を実行する。テスト専用 Mod、JUnit reporter、構造 NBT は `gametest` source set に隔離して配布 JAR から除外する。1.20.1 の資源は `loot_tables` / `structures` を使い、main と gametest の両方に `pack.mcmeta` (`pack_format=15`) が必要。GameTest の `templateNamespace="fixture"` と `template="empty"` を分けて指定する。

サーバー `/fixture state x y z` とクライアント `/fixture_client state x y z` は状態を読み取る。固定 helper の Forge コマンド配送はローカルチャット画面を経由しないため、サーバーにも player 本人用の `fixture_client` リレーを登録している。リレーは位置だけを [SimpleChannel](https://docs.minecraftforge.net/en/1.20.1/networking/simpleimpl/) の `PLAY_TO_CLIENT` packet で呼び出し元へ送り、実クライアントの main thread が Block Entity・menu・screen を独立して読み取る。サーバーの値を client 値として返したり、GUI・カウンターを変更したりしない。元の operator 用 `/fixture state` の条件は維持する。

`mch.fixture.breakSync` / `mch.fixture.failStart` の専用サーバー負例も保持する。loader 固有の GameTest XML 名は target の `caseAliases` で共通ケース ID に対応付ける。

2026-09-30 に Windows / GraalVM Java 17.0.10 でビルド、通常 JUnit 2 件、実 GameTest 2 件が成功した。サーバーはワールドを保存して停止し、依存 lock と manifest の Schema 検証も確認した。観測リレーを含む配布 JAR の SHA-256 は `12da156ae35fe966722541dbc96009b89c747e1887174caa95fbafa3bb257542`。配布 JAR による dedicated/client/multiplayer の確認状況はリポジトリ全体の検証記録を参照。

同じ配布 JAR の fresh PoC では、helper-free client smoke 3 件、実プレイヤーによる配置・GUI・同期・再接続 6 件、2 クライアントの追随・再接続 7 件がすべて成功した。画像でも `Counter: 1` を確認し、peer は GUI を開かず Block Entity の値 1 を観測した。終了後、使用した 7 ポートと 4 client PID が残っていないことを確認した。先行した Forge INFO ログ判定の失敗と、offline OP profile 名の大小文字に起因する照会権限失敗の証拠を保持し、新 JAR による fresh run で修正を検証した。
