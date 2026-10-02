# Minecraft Mod 開発向け AI Agent ハーネスの既存事例調査

調査日: 2026-09-28。対象は **Minecraft Java Edition** の Mod 開発。NeoForge、Fabric、複数ローダー・複数 Minecraft バージョン、実クライアント、専用サーバー、レシピ・進行バランスを中心に、各プロジェクトの公式文書または開発元リポジトリを確認した。以下の対応範囲や機能は原則として各プロジェクトの自己申告であり、このリポジトリでの導入・実機検証はしていない。バージョン表は変化が速いため採用時に再確認すること。

## 要約

- **ビルドの土台**: [MultiLoader Template](https://github.com/jaredlll08/MultiLoader-Template) は `common` / `fabric` / `neoforge` を分ける、追加の共通実行時ライブラリを要求しない構成。[Architectury API / Loom](https://github.com/architectury/architectury-api) はローダー差の抽象化を提供する。[Stonecutter](https://github.com/stonecutter-versioning/stonecutter) は同じソースから複数バージョンの派生ビルドを作る。両軸を合わせた[公式系の Fabric + NeoForge テンプレート](https://github.com/stonecutter-versioning/stonecutter-template-multiloader)や[コミュニティ製の Fabric + NeoForge + Forge テンプレート](https://github.com/rotgruengelb/stonecutter-mod-template)もある。
- **Agent にゲームを見せる**: [mc-pilot](https://github.com/kzheart/mc-pilot) は JSON を返す CLI と Agent Skill、[minecraft-mod-mcp](https://github.com/langyo/minecraft-mod-mcp) と [MCP Fabric](https://github.com/Etoryx/mcpfabric) はゲーム内 Mod + MCP ブリッジ。[mcdev-mcp + DebugBridge](https://github.com/use-ai-for-mc/mcdev-mcp) はソース調査と実クライアント観察を結ぶ。ただし対応ローダー・バージョン、操作対象、導入方法は異なる。
- **テスト**: [Fabric の自動テスト](https://docs.fabricmc.net/develop/automatic-testing)と[NeoForge Game Tests](https://docs.neoforged.net/docs/misc/gametest/)でゲーム内の再現可能なテストを作れる。完成 JAR の起動確認には[MC-Runtime-Test](https://github.com/headlesshq/mc-runtime-test)と[MC-Server-Test](https://github.com/headlesshq/mc-server-test)がある。専用サーバーの起動と接続の確認は、シングルプレイのテストとは別のゲートにするのが妥当。
- **バランス**: [EMI](https://github.com/emilyploszaj/emi) はゲーム内のレシピツリー、[Pack Master](https://github.com/otectus/Pack-Master)は実行中のレジストリ・レシピの JSON ダンプと差分、[minecraft-recipe-graph](https://github.com/Jacob-Lasky/minecraft-recipe-graph)は古い Forge 環境でのオフライン材料ツリーを示す。**全ローダー・全版の実効レシピを収集し、コスト・循環・到達可能性・版間差分をまとめて評価する完成済みの共通基盤は、今回確認した範囲では見つからなかった。**

## 1. ハーネス全体・Agent 向け部品

| 候補 | 確認できた範囲 | ハーネスに取り込む際の位置づけ |
|---|---|---|
| [mc-pilot](https://github.com/kzheart/mc-pilot) | Mod/プラグインのテスト向け CLI。サーバー・クライアントの起動管理、移動、ブロック・インベントリ・GUI 操作、スクリーンショット、ログ待機、複数クライアントを扱う。JSON 出力、`mct schema`、Codex 等へインストールできる Skill を提供。README に Fabric / Forge / NeoForge の版別検証表がある。 | **実動作テストの有力な入口**。テスト対象 Mod の配備方法、対象版での実際の動作、CI の OS 条件を小さな PoC で確認したい。録画ヘルパーは README 上 macOS 限定。 |
| [minecraft-mod-mcp](https://github.com/langyo/minecraft-mod-mcp) | Forge / Fabric / NeoForge のゲーム内 Mod と MCP ブリッジ。画面撮影、GUI クリック・入力、キー操作、状態照会、イベント取得をうたう。開発者向けの Mod スモークテストを明示し、別途クライアント・サーバー起動等の[CLI ガイド](https://github.com/langyo/minecraft-mod-mcp/blob/master/docs/guides/en/CLI.md)も案内している。 | 画面・GUI 中心の Agent 操作候補。版ごとの配布 JAR、ツールの安定性、専用サーバーで使える機能を確認する。 |
| [MCP Fabric](https://github.com/Etoryx/mcpfabric) | 名称に反して Fabric / NeoForge のクライアントと専用サーバーに対応すると記載。ローカル HTTP ブリッジ + TypeScript MCP。ブロック・エンティティ照会、移動、建築、スクリーンショット、サーバーコマンドなど。 | ワールド状態の観測・操作、サーバー管理に強い候補。書込み・コマンド実行の権限が大きいため、テスト環境のローカル接続・トークン・機能制限を設定する。 |
| [mcdev-mcp](https://github.com/use-ai-for-mc/mcdev-mcp) + [DebugBridge](https://github.com/use-ai-for-mc/debugbridge) | Minecraft ソースのダウンロード・逆コンパイル・シンボル検索に加え、DebugBridge を入れた Fabric クライアントの実行時状態、画面、スクリーンショット、ログ等を照会。`minecraft-dev-loop` Skill と MCP リソースが再ビルド・再起動・再接続の手順を案内する。DebugBridge 側は維持対象版を限定している。 | Agent が API を推測せず調査する用途と Fabric 実機デバッグに有用。README は静的解析がクライアント JAR 中心と明記。NeoForge 実機の共通操作口にはそのまま使えない。 |
| [ModLens MCP / CLI](https://github.com/CreeperHost/modlens-mcp) | Minecraft / Mod JAR のソース・バイトコード・Mixin・AT/AW・依存関係・レシピ等の調査、衝突・sidedness レポート、クラッシュログ解析。Gradle 実際のコンパイルクラスパスを取り込む機能と、実クライアント起動・画面操作機能も記載。 | **静的調査の広い部品**。sidedness はメタデータ等からの分類であり、専用サーバーでの成功証明とは区別する。Gradle エクスポートの自動ソース発見は README 上 ModDevGradle に特化。 |
| [minecraft-mod-dev](https://github.com/chouzz/minecraft-mod-dev) | Claude Code Plugin / Skill。NeoForge / Fabric の資料参照、JEI / AE2 / Create 連携、環境検出などの作業指針。 | Agent の**知識・手順**の先行例。両ローダー対応の成果物を自動ビルド・テストするハーネスとは別。 |
| [minecraft-mod-builder](https://github.com/Riloox/minecraft-mod-builder) | Claude Code Skill。ローダー・MC 版を選び、Mod を生成し `gradlew runClient` まで案内。 | 初期構築フローの参考。単独ローダーを選ぶ手順で、同一 Mod のマルチローダー検証を主目的にはしていない。 |
| [ai-minecraft-mobs-creator](https://github.com/shrimpwagon/ai-minecraft-mobs-creator) | Claude Code で NeoForge Mod のモブ・ブロック・テクスチャを生成し、JAR ビルド、ランチャー配備、複数角度のプレビューを行う雛形。 | アセットを含む生成→ビルド→視覚確認の参考。README の対象は NeoForge 1.21.1。 |

**境界**: ゲームを自律プレイする Agent やゲーム内チャット Bot は多いが、Mod のソース変更→版別ビルド→クライアント・専用サーバー確認→成果物の証拠保存まで結ぶものとは目的が異なる。上表では開発ワークフローへの利用を明記したものを優先した。

## 2. NeoForge / Fabric の同時対応

ここでいう「同時対応」は**同じソース群から各ローダー向け成果物を作る**意味。1 つのゲームプロセスへ両ローダーを同時導入する意味ではない。

| 選択肢 | 仕組みと利点 | 留意点 |
|---|---|---|
| [Jared の MultiLoader Template](https://github.com/jaredlll08/MultiLoader-Template) | `common` は Minecraft 本体に対してコンパイルし、ローダー固有処理を `fabric` / `neoforge` に置く。README は追加の共通ライブラリ依存なしと明記。ローダー差の境界が明瞭。 | API の差分は自分で抽象化する。`common` からローダー固有 API は参照できない。GameTest の共通ソースセット設計も別途必要。 |
| [Architectury API + Loom + Injectables](https://github.com/architectury/architectury-api) | Architectury API が Fabric / Forge 系 API の共通化を提供。Loom は複数プラットフォーム開発、`@ExpectPlatform` は実装の差し替えに用いる。 | 利用する API と対象版の組合せを固定・検証する。API を実行時依存にするかは使用部分による。ビルドだけでなく各ローダーの挙動をテストする。 |
| [Stonecutter multiloader template](https://github.com/stonecutter-versioning/stonecutter-template-multiloader) / [stonecutter-mod-template](https://github.com/rotgruengelb/stonecutter-mod-template) | ローダーと MC 版をビルド派生にまとめる。後者は Fabric / NeoForge / Forge、複数 MC 版、GitHub Actions を明示。 | 条件分岐や版別依存が増えたときの読解・保守コストがある。テンプレートの対応版を無条件で全版の動作保証と見なさない。 |
| [Forgix](https://github.com/PacifistMC/Forgix) | 既にビルドした Fabric / NeoForge 等の JAR を 1 つの配布 JAR へ統合し、複数バージョンの統合も設定可能。 | **ビルド構成・API 差の解決手段ではなく配布物統合の段階**。統合後 JAR をローダーごとに起動検査する必要がある。 |

Agent 用には、`common` と各ローダー固有モジュールの責務を明文化し、**同じ仕様テストを各ローダーで実行**する設計が重要。単に両方でコンパイルが通るだけでは、登録順序・同期・GUI・データ生成の差を捉えられない。[Fabric Loom](https://docs.fabricmc.net/develop/loom/) と [NeoForge ModDevGradle](https://projects.neoforged.net/neoforged/moddevgradle) の実行タスクは版に応じて変わるため、ハーネスからは固定コマンドを直書きせず、プロジェクトごとのタスク・JDK・依存版を定義するのがよい。

## 3. 複数 Minecraft バージョン

| 候補 | 使いどころ | 限界・確認事項 |
|---|---|---|
| [KikuGie 系 Stonecutter](https://github.com/stonecutter-versioning/stonecutter) | 版ごとの Gradle サブプロジェクトと、ソース中の版別条件を管理する中心候補。Gradle Plugin Portal に[プラグイン](https://plugins.gradle.org/plugin/dev.kikugie.stonecutter)がある。 | ローダー軸との組合せ数だけビルド・テスト費用が増える。版別条件を積み過ぎると共有ソースが読みにくくなる。元の [SHsuperCM 版](https://github.com/SHsuperCM/Stonecutter)は自身の README で KikuGie fork の利用を勧めている。 |
| 版ごとのブランチ / サブプロジェクト | 大きな API 差を隔離しやすい。個々の版を独立して安定化できる。 | 共通修正の移植漏れが起きやすい。AI Agent には差分移植と版別テストの記録が必要。 |
| [Fabric Loom](https://docs.fabricmc.net/develop/loom/) と [ModDevGradle](https://projects.neoforged.net/neoforged/moddevgradle) | 各版の開発環境、runClient / runServer / GameTest の実行基盤。 | これら単体がマルチバージョンのソース切替を解決するわけではない。対応する JDK、Gradle、マッピング、API・ローダーの組合せを版ごとに固定する。 |

版 × ローダーの全組合せを毎回フル実機テストするより、**変更箇所に関係する組合せを短いループで実行し、リリース前には全サポート組合せで完成 JAR を確認**する運用が現実的。これは既存ツールの機能ではなく、この調査に基づくハーネス設計案。

## 4. 実クライアントでの動作確認

| 層 | 既存手段 | 何を確かめられるか / 注意点 |
|---|---|---|
| 開発環境起動 | [Fabric Loom の run 設定](https://docs.fabricmc.net/develop/getting-started/intellij-idea/launching-the-game)、[ModDevGradle の client run](https://projects.neoforged.net/neoforged/moddevgradle) | 最短の手動デバッグ・起動確認。アサーションや画面証拠は別途用意。 |
| ゲーム内の再現可能なテスト | [Fabric Client GameTest](https://docs.fabricmc.net/develop/automatic-testing)。単人ワールド作成、チャンク描画待ち、スクリーンショットなどの例がある。 | Fabric の公式ドキュメントでは `runClientGameTest` を提示。クライアント機能の回帰テストに適する。CI で画面が必要な場合 Xvfb 等の設定を確認。 |
| Agent による操作・観察 | [mc-pilot](https://github.com/kzheart/mc-pilot)、[minecraft-mod-mcp](https://github.com/langyo/minecraft-mod-mcp)、[MCP Fabric](https://github.com/Etoryx/mcpfabric)、[mcdev-mcp / DebugBridge](https://github.com/use-ai-for-mc/mcdev-mcp) | GUI、移動、アイテム、イベント、画像を検査できる範囲は製品ごとに違う。自動操作の成功を、ゲーム内状態・ログ・画像の複数の証拠で検証したい。 |
| **配布 JAR** のスモークテスト | [MC-Runtime-Test](https://github.com/headlesshq/mc-runtime-test) + [HeadlessMC](https://github.com/headlesshq/headlessmc) | GitHub Actions で実際のクライアントを起動し、ワールド参加・チャンクロード等を確認。複数版・ローダー対応表あり。開発用 classpath と違う、配布後だけの不具合を発見できる。GameTest 連携もあるが、README は Forge / NeoForge のテスト発見に追加設定が要る場合を明記。 |

## 5. 専用サーバーでも問題ないか

1. **早い静的チェック**: [Fabric の `main` / `client` entrypoint と `environment`](https://docs.fabricmc.net/develop/getting-started/project-structure)、[NeoForge の物理・論理 side](https://docs.neoforged.net/docs/concepts/sides/)に従ってクライアント専用クラスの参照を分ける。[ModLens](https://github.com/CreeperHost/modlens-mcp) の sidedness / Mixin / 依存関係診断はここに置ける。ただし静的判定には限界がある。
2. **開発サーバーでの機能テスト**: [NeoForge Game Tests](https://docs.neoforged.net/docs/misc/gametest/) は `gameTestServer` run、[Fabric の自動テスト](https://docs.fabricmc.net/develop/automatic-testing)はサーバー GameTest を提供。ワールド内のブロック・エンティティ・レシピ・同期などを再現可能にする。NeoForge の[テストフレームワーク](https://github.com/neoforged/NeoForge/blob/26.3.x/docs/TESTFRAMEWORK.md)は手動 UI と CI 向け GameTest の両方を記載。
3. **完成 JAR をクリーンな専用サーバーへ配備**: [MC-Server-Test](https://github.com/headlesshq/mc-server-test) は Fabric / NeoForge 等でサーバー起動・ログ応答・コマンドを CI から検査する。デフォルトは「ワールド起動後に停止」なので、動作の深い確認には独自コマンドまたは GameTest を加える。
4. **実クライアントから接続**: サーバーが起動してもネットワーク登録、ログイン、同期、画面表示までは確かめられない。[mc-pilot](https://github.com/kzheart/mc-pilot) のサーバー + 複数クライアント起動と状態・ログ照会、または MCP ブリッジを使い、接続・相互作用まで見る。

判定結果は「静的チェック」「専用サーバー起動」「サーバー GameTest」「実クライアント接続」を分けて記録する。シングルプレイは統合サーバーを使うため、専用サーバーでの client-only クラスロード問題を取りこぼし得るという点が、独立ゲートを設ける理由である。[NeoForge 側面の説明](https://docs.neoforged.net/docs/concepts/sides/)を参照。

## 6. バランス・レシピツリー・進行グラフ

| 候補 | 可視化 / データ | 範囲・限界 |
|---|---|---|
| [EMI](https://github.com/emilyploszaj/emi) | Fabric / NeoForge 向け API を持つゲーム内レシピビューア。レシピツリーと材料集計の先行実装。 | プレイヤーが特定アイテムの製作を追う UI として有用。全進行の監査や版間差分のレポートを直接出す目的ではない。複数の最終産物を一つのツリーで扱う要望は[未実装の issue](https://github.com/emilyploszaj/emi/issues/1041)として残る。 |
| [Pack Master](https://github.com/otectus/Pack-Master) | 実行中のゲームからアイテム、レシピ、タグ、戦利品、進捗などを JSON に抽出。レシピの入出力検索、孤立アイテム、重複レシピ、ダンプ間差分、CSV、REST API。 | README の対応は **Forge 1.20.1**。抽出・監査パイプラインの有力な設計参考だが、そのまま Fabric / NeoForge 共通部品にはできない。 |
| [minecraft-recipe-graph](https://github.com/Jacob-Lasky/minecraft-recipe-graph) | `/recipedump` とオフライン Python CLI で Modpack の材料ツリー・総コスト・HTML 表示。AE2 在庫による差引きも扱う。 | Forge 1.12.2 など旧版重視。実行中の JEI 連携レシピを含めるためゲーム内ダンプを使う設計が参考。汎用の現行版共通分析器ではない。 |
| [MinecraftRecipeMapper](https://github.com/Syndaryl/MinecraftRecipeMapper) | Minecraft / Create のレシピ JSON を読んで依存グラフを作る .NET アプリを目指す。 | README の project goals に未完了チェックが並ぶため**構想・試作段階**として扱う。JAR 内 JSON だけではコード生成レシピ、JEI/EMI 独自登録、データパックによる上書きを取りこぼす可能性がある。 |
| [ModLens](https://github.com/CreeperHost/modlens-mcp) | Mod JAR 内のレシピ・タグ、依存グラフ、競合、差分を CLI / MCP で調査。 | 静的ファイル解析に強い。実行後の RecipeManager や独自機械レシピ全体を網羅する保証とは区別する。 |
| [JEI](https://github.com/mezz/JustEnoughItems) / [REI](https://github.com/shedaniel/RoughlyEnoughItems) | ゲーム内のアイテム・レシピ探索の基礎となるビューア。 | プレイヤー向けのレシピ確認、Mod のレシピ表示連携に使う。横断的なバランス分析は別レイヤー。 |

**ハーネスに必要そうな未充足部分（推論）**: 対象版・ローダーごとにロード済みレシピとタグを同じ形式へ正規化し、レシピを「入力集合・出力集合・数量・時間・エネルギー・確率・触媒・取得経路」のハイパーグラフとして扱う。循環、生成不能な中間品、意図しない短絡、目標アイテムまでの材料・時間コスト、版・ローダー間の差分をレポートする。機械レシピやドロップはデータ形式が Mod 固有なので、アダプター方式が必要になる。EMI の表示を Agent が見るだけでも初期 PoC になるが、CI で比較できる構造化出力とは分けて設計する。

## 7. ハーネスを組むなら試す順序

これは調査結果からの**提案**で、既存ツールの機能一覧ではない。

1. 対象となる Minecraft 版と NeoForge / Fabric の組合せを少数に決め、[MultiLoader Template](https://github.com/jaredlll08/MultiLoader-Template) か [Stonecutter の multiloader template](https://github.com/stonecutter-versioning/stonecutter-template-multiloader)で最小 Mod をビルドする。複数版が初日から必須なら後者を優先。
2. 同一仕様の小さなブロック・アイテム・レシピについて、両ローダーでビルドと[GameTest](https://docs.fabricmc.net/develop/automatic-testing)を通す。NeoForge 側のテストは[NeoForge 公式資料](https://docs.neoforged.net/docs/misc/gametest/)に合わせて実装する。
3. 完成 JAR を[MC-Runtime-Test](https://github.com/headlesshq/mc-runtime-test)と[MC-Server-Test](https://github.com/headlesshq/mc-server-test)で別々に起動。版 × ローダー × client/server の結果、ログ、JAR ハッシュを保存する。
4. [mc-pilot](https://github.com/kzheart/mc-pilot)または MCP ブリッジのうち、対象版で実際に動く一つを PoC で採用し、Agent が「起動→アイテム取得→設置/使用→結果・画面・ログ確認」を再現できるようにする。
5. レシピはまずロード済みデータの JSON 抽出と版別差分から始め、次にツリー・グラフ・コスト計算へ進む。[Pack Master](https://github.com/otectus/Pack-Master)のダンプと [EMI](https://github.com/emilyploszaj/emi) の UI を比較対象にする。

## 調査上の未確認点

- この作業領域には Mod プロジェクトがなく、ツールのインストール、Gradle タスク実行、CI 成功、実ゲーム内の再現確認は未実施。
- 上記の小規模な MCP / Skill / CLI プロジェクトは README が詳しくても、対象版での安定性、メンテナンス、セキュリティ、Windows と CI での動作は採用前の PoC が必要。
- 「レシピ」と「進行」は同義ではない。入手手段にはワールド生成、ドロップ、交易、戦利品、進捗条件、独自機械処理も含まれる。レシピ JSON のみのグラフをゲームバランス全体の証拠にはできない。
