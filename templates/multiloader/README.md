# 四つのターゲットを同じ Suite で検証する

この設定は配布物内の `fixtures/example-mod`、`fixtures/neoforge-1.21.1`、`fixtures/fabric-1.20.1`、`fixtures/forge-1.20.1` を独立した Gradle ビルドとして接続します。各ビルドは `fixtures/common` の純 Java ソースと `templates/gradle/harness-export.gradle` を参照します。この相対配置を保ち、ここにある `harness.config.json` と `harness.lock.json` を検証プロジェクトのルートへ配置します。配布物のルートにも同じ明示設定があります。

unit、server-gametest、server-smoke、client-smoke、multiplayer、multi-client の期待ケースと件数は全ターゲットで共通です。`targets.<id>.caseAliases` が Loader 固有の実 GameTest ID を共通 ID へ変換し、`suiteBindings` が runtime と helper をターゲット別に接続します。共通 Suite の runtime/pilot は既定値として定義されますが、この例では全ターゲットが明示 binding を持ちます。

`harness.local.json` は端末で用意します。`java17` / `java21` の Java home、固定 backend の場所、必要なら固定 tool の既存ファイル、期限と既存 EULA 同意を指定します。共有 JSON に絶対 Java パスや EULA 同意を追加しません。ツールの導入は [ツール](../../docs/tools.md)、local の書式は [設定契約](../../docs/configuration.md) を参照してください。

```console
mch doctor --project . --json
mch inspect --project . --target fabric-1.20.1 --json
mch build --project . --target fabric-1.20.1 --json
mch test --project . --target fabric-1.20.1 --profile release --json
```

他の三つのターゲットも同じコマンドの `--target` を変えて検証します。`release` は宣言した必須 Suite を実行し、未対応・未実行・テスト数不足を成功に変換しません。対象 OS と実証済み範囲は [対応状況](../../docs/support.md)、独立ビルドと共通ソースの境界は [構成](../../docs/architecture.md) を参照してください。

新しい Mod へこの例を接続する場合、fixtures のディレクトリ名だけを変えて済ませず、対象ビルドのタスク、明示成果物、classpaths、結果 XML と期待ケースを合わせます。fixture 専用の multiplayer drivers は counter block、GUI、観測コマンドの仕様を前提にしています。
