# 既存プロジェクトへ接続する

この設定例をプロジェクトへコピーし、Minecraft・ローダー、Java の参照名、既存の Gradle タスク、実際の JUnit 結果ファイルを合わせる。Mod ソースを特定テンプレートへ移行する必要はない。

`build/harness/fabric-1.21.1.json` に、解決済みの版・マッピングと明示した配布 JAR・実行依存を出力する。[設定契約](../../docs/configuration.md) の artifact manifest 例を使う。Gradle のエクスポートを後から追加する場合は `tasks.inspect` に対応タスクを設定する。生成済み JAR のワイルドカード選択は行わない。

端末の Java home は無視対象の `harness.local.json` に配置する。初期設定で `mch doctor --json` と `mch inspect --target fabric-1.21.1 --json` を実行する。必須 Suite の未実装は unsupported のまま明示する。プロジェクトの side・機能を根拠に必須条件を決め、接続できてから実際の Driver に置き換える。

共有設定・Gradle 依存 lock と CLI 版をコミットする。`.harness/`、`harness.local.json`、個人の `.minecraft`、認証情報は共有しない。
