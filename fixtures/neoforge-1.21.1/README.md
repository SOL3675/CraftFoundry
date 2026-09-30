# NeoForge 1.21.1 fixture

`fixture:counter` を使用するとサーバーでカウンターを増やし、GUI を開く。Block Entity の値と GUI の値を同期し、ワールドへ保存する。サーバーの `/fixture state x y z` とクライアントの `/fixture_client state x y z` は状態を読み取り、`MCH_FIXTURE_SERVER` / `MCH_FIXTURE_CLIENT` の JSON をチャットへ出す。

固定構成は Minecraft 1.21.1、NeoForge 21.1.252、ModDevGradle 2.0.148、Gradle 9.2.1、Java 21。`gradle.lockfile` は実際に解決した依存を固定する。Wrapper の distribution SHA-256 も固定済み。端末の Java home は無視対象の `harness.local.json` に指定する。

```powershell
$env:JAVA_HOME = '端末の Java 21 home'
$env:GRADLE_USER_HOME = Join-Path $PWD '.harness/cache/gradle'
.\gradlew.bat --no-daemon --console=plain build harnessExport harnessServerGameTest
```

GameTest の実行には、同意済みの場合に限り `build/gametest/eula.txt` へ `eula=true` を配置する。Gradle タスクは EULA に自動同意しない。

`harnessExport` は [共有 Gradle スクリプト](../../templates/gradle/harness-export.gradle) を使い、解決済みの Minecraft・NeoForge 版と明示した `jar` の成果物を `build/harness/neoforge-1.21.1.json` に出す。配布 JAR は `build/libs/harness-fixture-neoforge-0.1.0.jar`。専用 GameTest Mod、JUnit reporter、テスト構造は `gametest` source set に隔離し、配布 JAR に含めない。

`harnessUnit` は通常の JUnit 2 件、`harnessServerGameTest` は Minecraft の実 GameTest 2 件を実行する。後者は専用テスト Mod がバニラの `JUnitLikeTestReporter` を設定して `build/test-results/gametest/results.xml` を保存する。共有設定の `caseAliases` はローダー固有の XML 名を `fixture.counter_initial` / `fixture.counter_persistence` へ対応付ける。

`-Dmch.fixture.breakSync=true` は専用サーバー側の Block Entity と GUI の同期値を 0 に固定する負例、`-Dmch.fixture.failStart=true` は専用サーバーの Mod 初期化を失敗させる負例。クライアント単独の統合サーバーには適用しない。

2026-09-30 に Windows / Java 21.0.5 上で、ビルド、通常 JUnit 2 件、実サーバー GameTest 2 件、配布 JAR からのテスト補助コード除外を確認した。配布 JAR によるクライアント・マルチプレイの対応状況はリポジトリ全体の検証記録を参照。
