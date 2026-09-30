# Gradle の成果物エクスポート

`harness-export.gradle` を既存ビルドへコピーし、`ext.harnessExportSpec` を設定してから `apply from: 'harness-export.gradle'` を追加する。共有スクリプトが `harnessExport` タスクと `build/harness/<target>.json` を作る。Minecraft・ローダー・マッピングの解決は、そのプロジェクトの Gradle プラグインと設定を使う。

実行確認済みの例は [Fabric Loom 1.8.13](../../fixtures/example-mod/build.gradle) と [NeoForge ModDevGradle 2.0.148](../../fixtures/neoforge-1.21.1/build.gradle)。各例の `harnessExportSpec` を出発点にする。Gradle Wrapper はプロジェクト側のものを維持する。

| 設定 | 値 |
| --- | --- |
| `target`, `loader`, `java` | ターゲット ID、ローダー名、出力 Java toolchain のメジャー版 |
| `declaredMinecraft` | プロジェクトが宣言した Minecraft 版。解決済み版との不一致はエラー |
| `artifactTasks` | 明示した配布成果物・実行依存を生成するタスク名 |
| `resolved` | `minecraft`, `loaderVersion`, `mappings` を返す Closure。実際の解決結果を使用 |
| `artifacts` | `file`, `kind`, `side` の Map 一覧を返す Closure |
| `classpath` | 調査用 classpath の File 一覧を返す Closure |
| `sources` | プロジェクト内のソースディレクトリ一覧 |

Fabric は `remapJar` の `archiveFile` を指定し、必要な Fabric API を別の `runtime-dependency` として列挙する。今回の NeoForge は Mojang マッピングを使う `jar` の `archiveFile` が配布成果物になる。`build/libs/*.jar` の検索や先頭ファイルの選択は行わない。テスト専用 Mod は配布成果物に含めない。

配布成果物は実在する通常ファイルで、ビルドルート内に収まる必要がある。`kind` は `distribution` / `runtime-dependency` / `sources` / `development`、`side` は `client` / `server` / `both`。`distribution` は少なくとも一つ必要で、sources・development JAR の指定や重複を拒否する。調査用 classpath は外部の Gradle キャッシュへの絶対パスを許容する。これをゲームの Mod 配備へ使わない。

CLI では `tasks.inspect: ["harnessExport"]` と `artifactManifest: "build/harness/<target>.json"` を設定する。CLI 側でも成果物マニフェストの JSON Schema、ターゲットとの一致、実ファイルの位置とハッシュを確認する。[設定契約](../../docs/configuration.md) を参照。
