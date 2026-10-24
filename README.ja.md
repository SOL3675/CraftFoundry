# CraftFoundry

[English](README.md)

CraftFoundry は Minecraft Java Edition の Mod を、開発者・Agent・CI が同じ CLI からビルド・検証するハーネスです。npm パッケージは `craft-foundry`、CLI は `mch` です。プロジェクトの Gradle Wrapper を使い、配布 JAR のハッシュ、テスト結果、証拠を保存します。

## 導入とプロジェクトへの接続

Node.js 24 を使用します。パッケージは未公開・`private: true` です。[配布・更新](docs/distribution.md) に従ってローカル tarball の版を固定して導入してください。[設定](docs/configuration.md)、[existing-project](templates/existing-project/README.md)、[multiloader](templates/multiloader/README.md) の例で既存 Gradle task と明示的な artifact path を接続できます。Minecraft・ローダー・依存関係は Gradle で固定し、実機の Java home・ツール・EULA 状態は ignored `harness.local.json` に保存します。

| ターゲット | Gradle / コンパイル / ゲーム Java |
| --- | --- |
| NeoForge 1.21.1 | 21 / 21 / 21 |
| Fabric 1.21.1 | 21 / 21 / 21 |
| Forge 1.20.1 | 17 / 17 / 17 |
| Fabric 1.20.1 | 21 / 17 / 17 |

これは設定済み fixture のターゲットです。正確な pin と検証の制約は [対応状況](docs/support.md) を参照してください。他の組み合わせの対応は推測しません。

```console
mch doctor --json
mch targets --json
mch inspect --target fabric-1.21.1 --json
mch build --target fabric-1.21.1 --json
mch test --target fabric-1.21.1 --suite unit --json
mch test --all --profile release --json
mch report --run <run-id> --json
```

レポートと JUnit は `.harness/runs/<run-id>/` に保存されます。終了コードは成功 `0`、不合格 `1`、設定・環境不備 `2` です。JSON mode は標準出力に一つの object、標準エラーに進捗を出力します。必須ケースの未対応・skip・不安定な再試行・検出0件はリリース成功になりません。

同梱 Agent Skills は `mch skills install --destination .agents/skills --json` で導入します。installer は利用者の編集を維持します。固定 client backend は `mch tools install mc-pilot --project <directory> --json` で導入し、返された path をローカル設定に登録します。[Skills](docs/skills.md)、[ツール](docs/tools.md)、[Linux](docs/linux.md)、[CI](docs/ci.md) を参照してください。

## 実用的な開発計画

実装前に [検証計画・結果テンプレート](templates/validation/README.md) で AI の確認、人の確認、対象外・未検証の範囲を示し、人の確認を得ます。AI は機能が動くこと、build／logic、影響する重要な永続化を中心に確認し、GUI の細かな操作、プレイ感、balance は原則として人が確認します。人の確認待ちは失敗ではなく、網羅的な自動化を始める理由にもなりません。

[開発方針](docs/development.md) は native 機構、ビルド固定と runtime 互換範囲の区別、通常の Mod／config／datapack 変更を扱います。新しい [Minecraft 基礎 Skill](skills/minecraft-development-basics/SKILL.md) は inventory を操作する GUI で vanilla の menu／screen と slot・同期を使う方針などを、版ごとの API 確認とともに示します。合意済みの必須自動検証は、結果と証拠の正確性を維持します。

## 入手方法の変更をレビューする

[取得定義テンプレート](templates/acquisition/README.md) は独自 serializer・機械・その他の入手源を現在の [CraftAtlas](https://github.com/SOL3675/CraftAtlas) capture と照合する手順です。リポジトリ専用 [survival suite](docs/survival.md) は NeoForge／Fabric 1.21.1 と Forge／Fabric 1.20.1 に対応します。npm パッケージにはガイドとテンプレートが同梱され、runner の実行には Foundry リポジトリと pin 済み Atlas submodule が必要です。

バージョン限定定義の作成前に effective datapack JSON、source pack ID、byte hash、override stack を確認します。resource path は 1.21.1 が `recipe`、1.20.1 が `recipes` です。raw data、JEI／EMI の表示、有限な loot／block／entity／world 観測は証拠であり、実行可能性・網羅的な不在・持続的供給・進行を証明しません。未知の hook と不完全な coverage は unknown／未対応を維持します。Forge の fluid runtime は未検証です。

ハーネス自体の開発・テスト fixture・配布物の生成は [開発・配布](docs/distribution.md) に記載しています。

## ライセンス


CraftFoundry 独自のコードとドキュメントには [MIT](LICENSE) を適用します（Copyright (c) 2026 SOL3675）。個別のライセンス・著作権表示があるファイルは、その条件と表示を維持します。既存 fixture の MIT 表示と Gradle Wrapper の Apache-2.0 ヘッダー・同梱表示は変更しません。依存ライブラリ、取得するツール、Minecraft、他の Mod はそれぞれのライセンスに従います。npm パッケージには LICENSE と既存の fixture・Gradle 表示を、fixture のバイナリ・ソース JAR には既存の MIT 本文を `META-INF/LICENSE` として同梱します。npm パッケージは引き続き未公開・`private: true` です。
