# CI 設定の導入

`workflows/fixtures.yml` を対象プロジェクトの `.github/workflows/fixtures.yml`、`scripts/configure-fixtures.mjs` と `scripts/collect-fixture-evidence.mjs` を `.github/scripts/` へコピーしてください。この例は配布物ルートの四つの fixture / 共通ソース / 明示設定を同じ相対配置で使います。

手動 input の EULA 同意、固定 Java / Node、画面、証拠の保存範囲と未実行の制約は [CI](../../docs/ci.md) を参照してください。GitHub workflow の実成功や Xvfb の実ゲーム成功は、設定を配布したことだけでは確認済みになりません。
