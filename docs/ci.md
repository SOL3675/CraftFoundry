# CI の実行

契約テストは push / pull request、実 Minecraft fixture は手動の `workflow_dispatch` で実行します。GitHub にこの workflow を送信・起動していないため、GitHub-hosted runner 上の成功実績はありません。ローカルで実証した WSLg と、ここで構成する Xvfb / Mesa の実行は別の環境です。Xvfb での Minecraft 成功を WSLg の結果から推定しません。[Linux の実行記録](linux.md) と [対応状況](support.md) を確認してください。

## 配布物からの導入

配布物には [templates/ci](../templates/ci/README.md) の workflow とスクリプトを含みます。`workflows/fixtures.yml` をプロジェクトの `.github/workflows/fixtures.yml`、`scripts/*.mjs` を `.github/scripts/` へコピーします。リポジトリ内 `.github/` と配布用コピーは同じ内容です。この例は [四つの fixture 設定](../templates/multiloader/README.md) と、fixture/common/templates の相対配置を前提にします。

GitHub の Actions 画面で `Real fixture release suites` を選び、対象を `all` または四つの target ID から選択します。`eulaAccepted` は既定 false です。Minecraft EULA に同意済みで、隔離 CI サーバーへの再利用を許可するときだけ true を指定します。false の実行はゲームの取得前に失敗し、テストを実行した成功として扱いません。共有設定へ EULA 同意を書き込む操作はありません。

## 固定版と実行構成

| 項目 | 設定 |
| --- | --- |
| Runner | Ubuntu 24.04、ジョブ期限150分 |
| Node | 24.19.0 |
| Java | Eclipse Temurin 17.0.16+8 / 21.0.8+9 |
| CLI / backend | repository lockfile / mc-pilot 0.15.0 の固定 tar・依存 lock・SHA-256 |
| 画面 | Xvfb 1280×720×24、Mesa software renderer、`glxinfo -B` を保存 |
| Suite | 共通 OwnedServer / mc-pilot による全 required release Suite |

setup-java の各実行直後に `JAVA_HOME` を `MCH_JAVA17` / `MCH_JAVA21` へ保存します。[configure-fixtures.mjs](../templates/ci/scripts/configure-fixtures.mjs) は CLI の固定ツール導入結果と shared lock の hash を照合し、ignored `harness.local.json` に Java role・backend・既存 EULA 同意・期限を設定します。既存 local を上書きせず、shared config / lock は変更しません。

Gradle、npm、backend、ゲームの取得とセッションは workspace の `.harness/` 内へ配置します。Xvfb、Mesa、OpenAL、ALSA、フォントと X11 ライブラリは使い捨て CI runner に apt で導入します。runner image と apt package の実内容は更新されるため、固定 JDK / Node と renderer の実記録を合わせて確認してください。[setup-java の版指定](https://github.com/actions/setup-java/blob/b6effb05e454b25005698d916606bdc6ffcbf961/README.md) と [setup-node](https://github.com/actions/setup-node/blob/49933ea5288caeca8642d1e84afbd3f7d6820020/README.md) に従い、Actions 自体も commit SHA で参照します。

`doctor` は Xvfb を起動した同じ環境で、`glxinfo -B` の記録後に実行します。DISPLAY がない実クライアント環境は起動前に infrastructure-error となるため、ツール導入の段階では doctor を実行しません。

`all` は `mch test --all --profile release`、単一 target は同じ release profile の `--target <id>` を使用します。必須 Suite の unsupported、未実行、件数不足、期待ケース欠落は不合格です。MC-Runtime-Test / MC-Server-Test はこの CI に採用していません。

## 成功・失敗の証拠

`always()` で収集スクリプトと artifact upload を実行します。収集先は `.harness/ci/evidence/`、保存期間は14日です。

中断によって最終レポートが未生成、途中で切れた JSON、不正な JSON となった場合も、所有セッションのログ・クラッシュ情報・画面画像を包含検証したディレクトリから収集します。レポートの欠落を成功として補完せず、ゲームのキャッシュとワールドを収集対象へ広げません。この中断時の収集は Windows / Linux の契約テストで確認しています。

- CI の tool 導入結果、doctor、CLI の結果 JSON、実 `glxinfo`。
- Run の report / JUnit、redacted source identity、タスクログと XML、hash 付き Mod 成果物。
- report が参照する session evidence / logs、スクリーンショット、actions / session JSON、server.properties、crash text。

コピー後も `runs/<run-id>/` 以下の相対配置を維持するので、report 内の evidence path を辿れます。ゲームの runtime / download cache JAR、backend の node_modules、helper の実行状態や full world は artifact に含めません。Mod の明示 distribution / runtime dependency snapshots は検証対象の成果物として含めます。runner setup や EULA 入力で停止した実行に Run がなければ、実ゲームの合格 report は生成されません。
