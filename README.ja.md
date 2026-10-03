# CraftFoundry

npm パッケージ名は `craft-foundry`、CLI は `mch` です。[English](README.md) | [開発・配布手順](docs/distribution.md)。CraftAtlas は独立リポジトリで、固定コミットから未公開パッケージを生成して利用します。

Minecraft Java Edition の Mod を、AI Agent・開発者・CI が同じ CLI からビルドし、検証結果と証拠を保存する TypeScript / Node.js ハーネスです。

Node.js 24 を使用します。利用するプロジェクトの Gradle Wrapper を尊重し、Minecraft・ローダー・依存関係は Gradle 側で固定します。Gradle、コンパイル、ゲームの Java は分けて設定できます。

次のコマンドはハーネスのソースリポジトリを開発・検証する場合の手順です。配布物を別プロジェクトへ導入する手順は [配布・更新](docs/distribution.md) を参照してください。

```console
npm ci
npm test
npm run build
node dist/cli/main.js --help
```

導入先ではパッケージの版を開発依存として固定し、`mch` を呼び出します。プロジェクトへの接続は [設定契約](docs/configuration.md) を参照してください。

4 ターゲットの検証例はルートの共有設定と [推奨構成](templates/multiloader/README.md) にあります。独立した Gradle ビルドと共通 Java ソースを含みます。既存 Mod のソース構成を移行せずに接続する例は [existing-project](templates/existing-project/README.md) を参照してください。

```console
mch doctor --json
mch targets --json
mch inspect --target fabric-1.21.1 --json
mch build --target fabric-1.21.1 --json
mch test --target fabric-1.21.1 --suite unit --json
mch test --all --profile release --json
mch report --run <run-id> --json
```

実行結果は `.harness/runs/<run-id>/report.json` に、CI 向けの判定は `junit.xml` に保存します。JSON 出力時の標準出力は一つの JSON オブジェクトに限定し、進捗は標準エラーへ送ります。終了コードは成功 `0`、不合格 `1`、設定・環境不備 `2` です。

必須テストの未対応・未実行・検出0件はリリース成功になりません。ダミープロセスによるハーネス契約テストと実ゲームの動作確認は区別しています。対応範囲と制約は [対応状況](docs/support.md) を参照してください。

同梱 Skills は `skills/` にあります。コピーして導入する際は利用者の編集を維持し、CLI と同じ版の Skills・スキーマを使ってください。`harness.local.json`、`.harness/`、個人のゲーム環境は配布物に含めません。

固定バックエンドは `mch tools install mc-pilot --project <directory> --json`、Skills は `mch skills install --destination <directory> --json` で導入できます。初期設定は [ツール](docs/tools.md) と [配布・更新](docs/distribution.md)、OS ごとの設定は [Linux](docs/linux.md) を参照してください。

固定 Java と Xvfb による CI 設定と成功・失敗時の証拠回収は [CI](docs/ci.md)、配布用 workflow は `templates/ci` にあります。
