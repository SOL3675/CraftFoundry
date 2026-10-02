# CraftFoundry と CraftAtlas の開発境界

## 現在の配置

| プロジェクト | SOL-MAIN の実ディレクトリ | npm 名 / lockfile | 責務 |
| --- | --- | --- | --- |
| CraftFoundry | `F:\workspace\mc-dev-harness` | `craft-foundry` / `package-lock.json` | `mch` CLI、設定・結果スキーマ、Gradle / runtime アダプター、Skills、検証 fixture |
| CraftAtlas | `F:\workspace\craft-atlas` | `craft-atlas` / `pnpm-lock.yaml` | 収集 Mod、原本と正規化、解析、SQLite、CLI / Web UI、Atlas 固有 Suite |

CraftFoundry のプロジェクト名と npm 名を変更し、物理ディレクトリは維持しています。現在の作業ルート、両方の `harness.local.json`、共有キャッシュ、既存の実行証拠が旧パスを参照します。ディレクトリ改名は停止時間を確保し、端末設定と参照の更新をまとめて行う別作業です。過去の Run と検証記録は当時のパス・名称を保持します。

両方は独立した Git 履歴を持ち、現在 remote は未設定です。CraftAtlas は CraftFoundry のソースに依存せず、同じ版の `craft-foundry-0.1.1.tgz` を自身の開発依存に固定します。CraftFoundry は CraftAtlas に依存しません。tarball は配布成果物であり、ハーネスの編集元は CraftFoundry 一か所です。

CraftAtlas の runtime アダプターが利用する API は `craft-foundry/core/config`、`core/cache`、`core/tools`、`core/types`、`adapters/runtime/server`、`adapters/runtime/mc-pilot` の明示 export です。`mch`、`harness.*.json`、`.harness/`、`.mch-skills.json`、schemaVersion 1 と既存の Schema `$id` は互換性のため維持します。Schema の `.invalid` URI は識別子で、ホスト先や Git remote ではありません。

## ローカルの更新と検証

CraftFoundry で `npm run check` と `npm pack` を実行します。CraftAtlas へ新しい版の tarball をコピーし、旧依存を削除して `pnpm add --save-dev --save-exact ./craft-foundry-<version>.tgz --ignore-scripts` で導入します。`package.json`、`pnpm-lock.yaml`、新しい tarball を同じ変更として管理し、使用しなくなった旧 tarball は履歴に残して作業ツリーから除きます。同じ版の tarball を上書きすると integrity / store の整合性を壊すため、内容変更時は版を上げます。

CraftAtlas では `pnpm install --frozen-lockfile --ignore-scripts`、`pnpm check`、`pnpm test`、`pnpm build`、`pnpm exec mch targets --json`、`pnpm exec mch doctor --json` を確認します。設定された Gradle 環境では inspect / build と `atlas-offline` Suite も確認します。実ゲームの必須 Suite とオフライン契約テストの結果を区別してください。Skills は `pnpm exec mch skills install --destination .agents/skills --json` で更新し、手編集を保全します。

## private remote とサブモジュールへの移行（未実行）

1. 各 working tree の既存 `.ai` 文書と今回の変更を確認し、端末設定・認証情報・ゲームデータを除いて、それぞれの既存リポジトリにコミットします。自動 commit は行っていません。
2. GitHub に空の private repository をそれぞれ作成します。実在する URL と対象アカウントを確認してから、各 checkout に `origin` を追加し、現在のブランチと必要な tag を push します。README の自動生成や新しい Git 履歴への差し替えは不要です。URL・owner・branch はこの文書では仮定しません。
3. 両方の remote から復元でき、作業ツリーが clean であることを確認します。将来の配置候補は CraftFoundry 内の `projects/craft-atlas` です。このディレクトリと `.gitmodules` はまだ作成していません。
4. 既存 CraftAtlas の editor / server / Gradle / CLI を停止し、元の一つの checkout を候補パスへ移動します。既存パスへの参照を更新した後、CraftFoundry で `git submodule add <確認済み CraftAtlas remote URL> projects/craft-atlas` を実行します。既存 Git repository と同じ remote / history を使用し、gitlink と `.gitmodules` を CraftFoundry にコミットします。残った `.git` ディレクトリは必要に応じて `git submodule absorbgitdirs` で取り込みます。現 checkout のコピーを別の編集元として残さないでください。
5. CraftAtlas の変更は子リポジトリで commit / push し、CraftFoundry は確認済みの子 commit を指す gitlink を更新します。子の `.ai`、node_modules、キャッシュや run evidence を親に追加しません。子を root npm workspace に混ぜず、npm / pnpm の独立 lockfile と配布境界を維持します。
6. クラウド環境では Node.js 24、CraftAtlas 用 pnpm 11.19.0、対象 JDK / Gradle と OS 別依存を用意します。親は `npm ci`、子は `pnpm install --frozen-lockfile` で復元します。private submodule にアクセスできる認証を明示的に準備して `git submodule update --init --recursive` を実行し、子の checkout をその commit に固定します。端末固有の local 設定を再作成し、EULA は環境の利用者が確認します。GUI Suite に必要な display と backend は別途準備します。

この変更ではリモート作成・push・registry 公開・クラウド作成・認証変更・checkout 移動は実行していません。
