# ビルドと共有ソースの境界

ハーネスはターゲットの Minecraft、ローダー、Gradle タスク、明示成果物を設定から接続します。ローダー API をハーネス本体へ持ち込まず、各 fixture が解決済み依存から manifest を出力します。Build Adapter はビルドルート単位で Gradle 操作を直列化し、実行開始前に SHA-256 付きの成果物を Run 内へ保存します。別ターゲットのビルドが後から同じ JAR を更新しても、開始済みの実行は保存した成果物を使います。

## 独立した四つの Gradle ビルド

| ターゲット | ビルドルート | 主なビルド基盤 | コンパイル・ゲーム Java |
| --- | --- | --- | --- |
| Fabric 1.21.1 | `fixtures/example-mod` | Loom 1.8.13 / Gradle 8.10 | 21 |
| NeoForge 1.21.1 | `fixtures/neoforge-1.21.1` | ModDevGradle 2.0.148 / Gradle 9.2.1 | 21 |
| Fabric 1.20.1 | `fixtures/fabric-1.20.1` | Loom 1.8.13 / Gradle 8.10 | 17 |
| Forge 1.20.1 | `fixtures/forge-1.20.1` | ForgeGradle 6.0.36 / Gradle 8.8 | 17 |

この表はソース構成と固定ビルド基盤を示します。実行済み Suite と未検証の範囲は [対応状況](support.md) で管理します。Gradle 自体の Java は別の役割です。Java 17 のターゲットでも Gradle Java 21 を使用でき、local の Java ホームを Gradle toolchain discovery に渡して Java 17 でコンパイル・テスト・ゲームを実行します。ゲーム Java から Gradle Java を推定しません。Java の探索パスは明示的な `-Porg.gradle.java.installations.paths` と `-Dorg.gradle.java.installations.paths` の引数でも渡します。POSIX Wrapper のシェルがドットを含む環境変数を除去する場合にも、Java 17 と21の役割を維持します。

各ビルドルートは Wrapper、依存ロック、Loader 固有の登録・イベント・画面・通信・GameTest ランチャーを所有します。たとえば Fabric の remapped JAR、Forge の reobfuscated JAR、NeoForge の production JAR は、それぞれのビルドが明示的に export します。Yarn と Mojang mappings、NBT メソッド引数、Block のインタラクション API、リソースのディレクトリ名が異なるため、Minecraft に依存するソースを無理に一つにまとめません。

依存ロックは Windows の `gradle.lockfile` と Linux の `gradle/linux.lockfile` に分けます。Minecraft の runtime configuration は OS 固有の native module を選ぶため、Windows で生成した strict lock だけでは Linux の `netty-transport-native-epoll` が未記録となり、実 GameTest の起動前に解決が失敗しました。OS ごとの実 Gradle build / unit / GameTest で lock を生成し、その OS の通常実行では固定 lock を読みます。依存の和集合を一つの lock に書くと、逆の OS で未解決 module が残るので、この差を独立した lock に保ちます。

manifest の `buildEnvironment` は実行中 Gradle の版、Gradle JVM の版、`compileJava` が解決した compiler JVM の版を記録します。絶対 Java home は公開せず、toolchain 宣言と実解決の違いを確認できます。Forge 1.20.1 の初回実証では Gradle と compiler の両方が Java 17、Fabric 1.20.1 では Gradle Java 21 / compiler Java 17 でした。

## 共有する純粋 Java

`fixtures/common` の `CounterState` と `CounterStateTest` を各ビルドの `main` / `test` source set に追加します。共通ロジックは Java 17 の API だけを使い、各ターゲットの toolchain と `--release` でコンパイルします。別の共通 JAR を実行時に追加する構成ではないため、ローダー間でクラスローダーや依存 Mod を増やしません。

Block Entity の NBT 保存、update packet、GUI property 同期、プレイヤー操作、読み取り専用コマンド、GameTest 登録は各ローダー側に残します。純 Java テストは値の境界と復元を検証し、実 GameTest は Minecraft の Block Entity を配置して保存・復元を検証します。実クライアントとサーバーの同期は runtime Suite が検証します。

共有 Gradle スクリプト `fixtures/common/shared-sources.gradle` は `copySharedInspectionSources` で共通 main ソースを `build/harness/shared-sources/main/java` へ同期します。各 exporter はこのタスクに依存し、同期先を manifest の `sources` に加えます。ビルドルート外の元ソースを manifest の相対パスへ書かず、パスの包含検証を保ったまま、コンパイルした共通コードを inspection から読めるようにします。classpath は各ビルドで実際に解決されたものを公開します。

## Stonecutter の採用境界

現在の四つの fixture は独立したビルドルートを使い、Stonecutter を導入していません。Stonecutter のビルドや版切り替えを実行した証拠はなく、対応済みとは扱いません。ハーネスの複数ビルドルート対応には、Stonecutter の有無を条件として設けません。

今回の差は Java 17 / 21 だけでなく、三つのビルドプラグイン、二種類の mappings、ローダー固有の通信・登録・GameTest に及びます。そのため共有対象を純 Java に限定し、版とローダーの実装を独立してコンパイル・実行できる境界を選びました。新規 Mod の同一ローダー内で小さな API 差をまとめる際は、[Stonecutter の公式テンプレート](https://github.com/stonecutter-versioning/stonecutter-template-multiloader) を候補にできます。採用する場合は、その構成で build、manifest export、unit、実 GameTest、必要 runtime Suite を実行してから対応状況を更新します。作業ツリーを書き換える版切り替えは同一 checkout で直列化します。

## 新しいターゲットの移植手順

1. 公式の対象版 metadata / MDK から Minecraft、Loader、mappings、プラグイン、Wrapper と SHA-256 を固定し、新しい独立ビルドルートを作ります。既存の build、cache、local、認証情報はコピーしません。
2. `common/shared-sources.gradle` を適用し、共通 `CounterState` のコピーを作らず、対象の Java toolchain / release を指定します。Gradle Java とゲーム Java は shared の役割キーと ignored local の実パスで接続します。
3. 対象版の実 classpath を使って Block Entity、GUI、登録、ネットワーク、NBT、リソース、観測用コマンドを移植します。Loader 固有コードはそのルートに保存します。
4. 純 Java の unit 2件と実 GameTest 2件を実行します。結果 XML の実 ID を canonical `fixture.counter_initial` / `fixture.counter_persistence` へ alias し、件数・期待 ID を shared 設定で固定します。
5. Loader 固有の exporter から解決済みバージョン、明示 distribution / runtime dependency、classpath と source snapshot を出力します。sources / development JAR を実行用 distribution に選びません。
6. 固定 tool/helper、ゲーム Java、隔離サーバー・クライアントを接続し、必要 runtime Suite を実行します。接続前・実証前の Suite は unsupported とし、起動成功だけで動作検証を完了にしません。
7. 依存ロック、実結果、成果物 hash と対応状況を更新します。共通ロジック変更時は、それを使用する全ターゲットの unit と export を確認し、GUI・同期へ影響する変更は実 runtime でも再検証します。
