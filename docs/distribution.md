# 配布と更新

パッケージ名・公開先・ライセンスを確定する前の私有パッケージとして開発する。`npm pack` でローカル配布物を生成できる。公開操作は行わない。

```console
npm ci
npm test
npm pack
npm install --save-dev --save-exact ./mc-dev-harness-0.1.0.tgz
npx mch --help
```

CLI、JSON Schema、Skills、設定例、四つの独立した検証用 fixture と純 Java の共通ソースを同じ版で配布する。ルートの `harness.config.json` / `harness.lock.json` は四つのターゲットを共通 Suite と対象別 runtime/helper binding で接続する明示設定である。同じ配置向けの設定例は [multiloader](../templates/multiloader/README.md)、ソースの境界は [構成](architecture.md) を参照する。更新時はパッケージ版と lockfile を更新し、`mch doctor --json` から環境確認を行う。schemaVersion が異なる設定・結果は暗黙に変換しない。CLI と同じ配布物のスキーマ・Skills を使用する。

Skills は `mch skills install --destination <directory> --json` で導入・更新する。導入元のハッシュと版を記録し、利用者の編集は維持する。詳細は [Skills](skills.md) を参照する。生成・コピーした Mod ソースを自動更新する機能はない。

既存 Mod には `templates/existing-project` の対応設定から接続できる。推奨 fixture はテスト仕様を検証するためのもの。任意の Minecraft 版・ローダーに自動対応するテンプレートではない。

Minecraft 本体、依存ダウンロード、実行ログ、ワールド、端末固有設定、認証情報、`.ai/` は npm 配布物へ含めない。fixture のコードはその MIT 表示、Gradle Wrapper は上流の Apache-2.0 表示を維持する。外部バックエンドとその依存は別途取得し、固定版とハッシュ・ライセンスを確認する。実機で確認した組み合わせは [対応状況](support.md) を参照する。

2026-09-30 に `npm pack` を別ディレクトリへ導入し、同梱ファイルの全バイト、四つの fixture の OS 別依存 lock、共有設定とテンプレートの一致、実 `mch` bin、Skills の再導入を確認した。新規プロジェクトには同梱 fixture と設定をコピーし、Java の役割と既存の EULA 同意を local に指定した。固定 backend はそのプロジェクトの CLI で導入し、開発者側のツール・Minecraft キャッシュを参照せず Fabric 1.20.1 の全6必須 Suite・22ケースに成功した。Java 探索引数の修正後も、この別プロジェクトで配布 CLI の build・unit2・GameTest2 を再確認した。実ゲームの Run ID と対象環境は [対応状況](support.md) に記録している。
