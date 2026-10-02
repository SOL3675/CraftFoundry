# 配布と更新

CraftFoundry は npm パッケージ `craft-foundry` としてローカル配布する私有プロジェクトです。`private: true` と `UNLICENSED` を維持します。`npm pack` でローカル配布物を生成できる。公開操作は行わない。

## 配布物を作る側

以下は `craft-foundry` のソースリポジトリで実行する。`npm test` はハーネス自体の契約テストであり、配布物を導入するプロジェクトの Mod テストではない。

```console
npm ci
npm test
npm pack
```

## 配布物を導入する側

生成した tarball を導入先のディレクトリへコピーし、そのディレクトリで実行する。必要なのは Node.js 24 と npm。ソースのビルド用 TypeScript や契約テストを導入先で実行する手順は不要。

```console
npm install --save-dev --save-exact ./craft-foundry-0.1.1.tgz
npx mch --help
```

`npm install` は依存パッケージと `mch` コマンドを導入する。依存パッケージの `scripts` を導入先の `package.json` に追加することはない。導入先の `npm test` はそのプロジェクトの `scripts.test` を実行するため、未定義なら `Missing script: "test"` になる。導入先での `npm ci` は lockfile に従って依存を復元する操作であり、ハーネス設定やテストスクリプトを作らない。

既存 Mod の検証には [existing-project](../templates/existing-project/README.md) と [設定契約](configuration.md) に従って `harness.config.json` / `harness.lock.json` / `harness.local.json` を用意し、実際の Gradle タスクと成果物へ接続する。接続後は `npx mch test --target <target-id> --suite <suite-id> --json` で実行する。

## 同梱 fixture で動作を試す

既存 Mod への接続前に、同梱の検証用 Mod を別の作業ディレクトリへコピーして試せる。次の PowerShell は npm の導入先で実行する。`harness-example` は新規ディレクトリで、既存ディレクトリにはコピーしない。

```powershell
$packageRoot = Join-Path (Get-Location) 'node_modules/craft-foundry'
$exampleRoot = Join-Path (Get-Location) 'harness-example'
if (Test-Path -LiteralPath $exampleRoot) { throw 'harness-example は既に存在します。別の新規パスを指定してください。' }
New-Item -ItemType Directory -Path $exampleRoot | Out-Null
foreach ($name in @('fixtures', 'templates', 'harness.config.json', 'harness.lock.json')) {
    Copy-Item -LiteralPath (Join-Path $packageRoot $name) -Destination $exampleRoot -Recurse
}
npx mch targets --project ./harness-example --json
```

`harness-example/harness.local.json` に Java の絶対 home を指定する。次のパスは端末に配置した JDK 17 / 21 のものへ変更する。

```json
{
  "schemaVersion": 1,
  "java": {
    "java17": "C:/Java/jdk-17",
    "java21": "C:/Java/jdk-21"
  }
}
```

まず単体テストだけを実行できる。このコマンドは配布 JAR のビルドと純 Java の unit Suite を実行し、ゲームの起動・同期の成功を意味しない。

```console
npx mch test --project ./harness-example --target fabric-1.21.1 --suite unit --json
```

実ゲームを含む必須 Suite は [ツール](tools.md) に従って `npx mch tools install mc-pilot --project ./harness-example --json` を実行し、返された `backendRoot` を同ディレクトリの local 設定の `backends.mc-pilot` に追加する。Minecraft EULA に同意済みの場合だけ `eulaAccepted: true` を指定する。画面環境も準備し、`npx mch doctor --project ./harness-example --json` が通ってから実行する。

```console
npx mch test --project ./harness-example --target fabric-1.21.1 --profile release --json
```

導入先で `npm test` を入口にしたい場合は、接続が済んだ検証コマンドを導入先自身の `package.json` の `scripts.test` に指定する。たとえば上記の fixture unit 用なら次のようにする。既存の `test` スクリプトがあるプロジェクトでは、そのテスト構成に合わせて追加・統合する。

```json
{
  "scripts": {
    "test": "mch test --project ./harness-example --target fabric-1.21.1 --suite unit"
  }
}
```

CLI、JSON Schema、Skills、設定例、四つの独立した検証用 fixture と純 Java の共通ソースを同じ版で配布する。ルートの `harness.config.json` / `harness.lock.json` は四つのターゲットを共通 Suite と対象別 runtime/helper binding で接続する明示設定である。同じ配置向けの設定例は [multiloader](../templates/multiloader/README.md)、ソースの境界は [構成](architecture.md) を参照する。更新時はパッケージ版と lockfile を更新し、`mch doctor --json` から環境確認を行う。schemaVersion が異なる設定・結果は暗黙に変換しない。CLI と同じ配布物のスキーマ・Skills を使用する。

Skills は `mch skills install --destination <directory> --json` で導入・更新する。導入元のハッシュと版を記録し、利用者の編集は維持する。詳細は [Skills](skills.md) を参照する。生成・コピーした Mod ソースを自動更新する機能はない。

既存 Mod には `templates/existing-project` の対応設定から接続できる。推奨 fixture はテスト仕様を検証するためのもの。任意の Minecraft 版・ローダーに自動対応するテンプレートではない。

Minecraft 本体、依存ダウンロード、実行ログ、ワールド、端末固有設定、認証情報、`.ai/` は npm 配布物へ含めない。fixture のコードはその MIT 表示、Gradle Wrapper は上流の Apache-2.0 表示を維持する。外部バックエンドとその依存は別途取得し、固定版とハッシュ・ライセンスを確認する。実機で確認した組み合わせは [対応状況](support.md) を参照する。

2026-09-30 に `npm pack` を別ディレクトリへ導入し、同梱ファイルの全バイト、四つの fixture の OS 別依存 lock、共有設定とテンプレートの一致、実 `mch` bin、Skills の再導入を確認した。新規プロジェクトには同梱 fixture と設定をコピーし、Java の役割と既存の EULA 同意を local に指定した。固定 backend はそのプロジェクトの CLI で導入し、開発者側のツール・Minecraft キャッシュを参照せず Fabric 1.20.1 の全6必須 Suite・22ケースに成功した。Java 探索引数の修正後も、この別プロジェクトで配布 CLI の build・unit2・GameTest2 を再確認した。実ゲームの Run ID と対象環境は [対応状況](support.md) に記録している。
