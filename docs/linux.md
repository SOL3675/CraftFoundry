# Linux の契約検証

Linux でも設定、CLI、Gradle Wrapper 接続、プロセス管理、結果判定、レポートの契約を共通コードで検証します。契約テストのダミー Wrapper・子プロセス・バックエンドは Minecraft 本体を起動しません。実ゲームの対応実績は [対応状況](support.md) で別に管理します。

## 確認した環境

2026-09-30 に Windows 上の WSL Ubuntu 24.04.3 LTS、x86_64、Node.js 24.19.0 で確認しました。ソースと node_modules は `/mnt/f/workspace/mc-dev-harness`、テスト用の隔離プロジェクトは Linux の `/tmp` です。Node は作業領域の `.harness/linux-contracts/` に展開し、システムへのインストール、apt、ユーザーのホームディレクトリの変更は行っていません。

Linux では SIGKILL と子プロセスの実際の終了に短い間隔があります。プロセス管理のテストは、所有する PID の消失を最大3秒、15ミリ秒の間隔で確認し、期限内の終了を要求します。

最終ソースでは同じ123契約のうち Linux 115件成功・OS固有8件skip、失敗0を確認しました。Windows は121件成功・OS固有2件skip、失敗0です。設定・CLI・結果・レポート、Gradle の結果スナップショット、キャンセル・タイムアウト・所有子孫の回収、mc-pilot のバックエンド実ファイル検証、証拠の領域外参照拒否、サーバーの起動・停止を確認しています。契約テストのダミー backend / server は Linux の実ゲーム成功とは区別します。

## 固定 Node の取得と再実行

Node.js 24.19.0 の [公式 Linux x64 アーカイブ](https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz) を [公式 SHA-256 一覧](https://nodejs.org/dist/v24.19.0/SHASUMS256.txt) と照合しました。この版の Linux x64 アーカイブの SHA-256 は次のとおりです。

```text
14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647
```

リポジトリのルートで次を実行できます。既に Node 24 を固定して用意している環境では取得を省略できます。以下は Linux x64 向けで、ARM64 環境では対応するアーカイブと公式ハッシュを明示して指定してください。

```bash
set -euo pipefail
mkdir -p .harness/linux-contracts
cd .harness/linux-contracts
curl --fail --location --output SHASUMS256.txt \
  https://nodejs.org/dist/v24.19.0/SHASUMS256.txt
curl --fail --location --output node-v24.19.0-linux-x64.tar.xz \
  https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz
awk '$2 == "node-v24.19.0-linux-x64.tar.xz" { print }' SHASUMS256.txt > node.sha256
test -s node.sha256
sha256sum --check node.sha256
tar -xJf node-v24.19.0-linux-x64.tar.xz
cd ../..
export PATH="$PWD/.harness/linux-contracts/node-v24.19.0-linux-x64/bin:$PATH"
node --version
npm ci
npm run typecheck
npm test
```

依存関係が既に配置されている今回の検証では、同梱の Node を直接指定し、同じ lockfile に対応する純粋な JavaScript 依存を利用しました。

```bash
node_binary="$PWD/.harness/linux-contracts/node-v24.19.0-linux-x64/bin/node"
"$node_binary" node_modules/typescript/bin/tsc -p tsconfig.json
"$node_binary" --test tests/*.test.ts
```

Linux の Gradle プロジェクトは POSIX shell 形式の `gradlew` を用意します。CLI は `/bin/sh` で実行するため、Windows で生成した npm アーカイブが実行属性を保持しなくても呼び出せます。Java home や固定ツールの local パスは Linux の絶対パスで設定し、Windows の local 設定をそのまま使用しません。未指定の Gradle キャッシュはプロジェクトの `.harness/cache/gradle/` を利用し、明示した `GRADLE_USER_HOME` は維持します。

## 実ゲームと画面環境

この WSL 環境には `DISPLAY=:0`、`WAYLAND_DISPLAY=wayland-0`、`/mnt/wslg`、X11 socket ディレクトリがありました。`glxinfo` と `Xvfb` はありません。WSLg を使った Fabric 1.21.1 の配布クライアント、実 GUI の描画と画像、専用サーバーへの操作・同期・二つのクライアント・再接続は全16ケースに成功しました。ゲームログには実 LWJGL 3.3.3-snapshot のロードが記録され、GUI は `Counter: 1` を表示しました。証拠は `linux-game/run-1790760364872`、所有ポート全7件の閉鎖も確認しました。OpenGL renderer を `glxinfo` で測定した結果はありません。

Java は公式 Temurin の Linux x64 JDK 21.0.8+9 と17.0.16+8をポータブルに配置し、公式 SHA-256 と実 `java -version` を確認しました。アーカイブの hash はそれぞれ `f2dc5418092c43003db8f9005c4a286e1c0104fea96ccdd49e8ebd037cac9219`、`166774efcf0f722f2ee18eba0039de2d685b350ee14d7b69e6f83437dafd2af1` です。Windows の Java home は再利用しません。WSLg と CI の Xvfb の実績は分けます。

最終の共通 CLI `mch test --all --profile release` は Run `2026-09-30T11-19-12-322Z-c975034a`、Fabric 1.21.1 / NeoForge 1.21.1 / Fabric 1.20.1 / Forge 1.20.1 の全24必須 Suite・88ケースに成功しました。共有設定と lockfile は Windows と同じ内容です。各ターゲットは unit2 / GameTest2 / server-smoke2 / client-smoke3 / multiplayer6 / multi-client7を実行しました。結果 schema と JUnit88件、6成果物の hash、212相対証拠ファイルの実在と包含を照合済みです。所有32ポートは閉鎖、所有 Java / Node の残存は0で、token を確認した隔離 `/tmp` プロジェクトも削除しました。Fabric 1.20.1 の実 manifest は Gradle8.10 / JVM21.0.8 / compiler17.0.16+8を記録しました。

先行した全ターゲット Run `2026-09-30T10-44-21-934Z-5d2d16b6` は、Fabric 1.20.1 の Java 17 探索失敗で不合格です。POSIX shell がドットを含む環境変数を除去するため、Gradle Adapter に明示的な `-Porg.gradle.java.installations.paths` を追加しました。空白・日本語を含む JDK パスと、環境変数が無効な Wrapper の回帰テストを両 OS で通し、修正後の全88ケースを新しい Run で検証しています。失敗を隠す操作・アサーションの再試行は行っていません。

Linux も共通 OwnedServer / mc-pilot Adapter を採用します。MC-Runtime-Test と MC-Server-Test は採用候補として調査しましたが、既存の共通 Adapter で状態アサーション、複数クライアント、所有プロセス管理と証拠収集を実証できたため、追加しません。両候補の実行成功を主張するものではありません。固定版と描画環境を設定した [CI](ci.md) は、Run の report、JUnit、ログ、画像、Mod成果物と crash report を成功・失敗の両方で回収します。必須 Suite の unsupported・skipped・検出0件は Linux でも不合格です。

初回の CDN 接続失敗や /mnt/f 上での NeoForge の準備タイムアウトは別実行として保持しています。Linux では installer の同時取得数を2に制限し、記録付きのネットワーク取得再試行は最大3回に限定します。操作・アサーションの再試行は行いません。公式 hash に一致する資源 object と index は共有可能ですが、native library、prepared marker、クライアントの home/world はセッションごとに分けます。I/O の多い Linux 検証を ext4 に配置する場合も固有の所有 token と終了後の照合を必要とします。

固定クライアントの Linux 起動には X11 の `DISPLAY` が必要です。doctor と client Suite の実行前検証は未設定を環境不備として返し、クライアントを起動しません。Wayland の変数だけでは X11 を準備済みとしません。`DISPLAY` の存在確認と実 OpenGL 描画の成功は別です。実 helper-free クライアントの参加期限切れも readiness の環境不備として記録し、ゲーム内の状態アサーション不合格と区別します。
