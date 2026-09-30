# 設定契約

プロジェクトルートに `harness.config.json` を配置します。`mch --project <directory>` で別のルートを選べます。共有設定と成果物マニフェストは schemaVersion `1` を使用し、不明な項目・参照先・ローダー、Minecraft 1.20.1 未満の宣言はエラーになります。新しいターゲットを宣言できることと、そのターゲットの実機検証が完了していることは別です。[対応状況](support.md) を確認してください。

| ファイル | 内容 | バージョン管理 |
| --- | --- | --- |
| `harness.config.json` | ビルドルート、ターゲット、Suite、実行構成 | 共有する |
| `harness.lock.json` | 外部ツールの固定版、SHA-256、取得元 | 共有する |
| `harness.local.json` | Java・固定ツールの絶対パス、実行期限、EULA 同意状態 | 除外する |
| `.harness/` | Run、隔離セッション、証拠、実行ロック | 除外する |

local がない場合は `{ "schemaVersion": 1 }`、lock がない場合は `{ "schemaVersion": 1, "tools": {} }` を使用します。存在するファイルの JSON が壊れている場合はエラーです。local には必須 Suite やターゲットを上書きする機能がありません。

任意の `local.assetCache` は検証用に取得済みの Minecraft `assets/objects` ディレクトリの絶対パスです。バックエンドは内容を SHA-1 のファイル名と照合して各隔離セッションへコピーします。OS 固有の native library、ローダー準備済みマーカー、個人の設定やワールドは再利用しません。未指定なら公式資源を取得します。資源取得の限定的な再試行はログへ残し、ゲームの操作・アサーションは自動再試行しません。

版ごとに資源を分ける場合は `local.assetCaches` に `{ "1.21.1": "/absolute/assets/objects", "1.20.1": "/other/assets/objects" }` を指定します。対象版の値を優先し、未指定の版は `assetCache` または公式取得を使います。隣接する `assets/indexes` があれば JSON の内容と SHA-1 名を検証してコピーします。上流ランチャーが JSON を再整形した index は公式ハッシュと一致しないため、共有用には公式の元データを使います。

EULA が必要な Gradle / process Suite は `eulaRequired: true` を宣言します。Core は `local.eulaAccepted: true` を実行前に確認し、fixture の Gradle GameTest へも同意状態を渡します。

## Gradle プロジェクトへの接続

次の例は既存の Gradle Wrapper とタスクへ接続します。タスク名と結果ファイルは実際のプロジェクトに合わせて変更してください。

```json
{
  "schemaVersion": 1,
  "projectId": "example-mod",
  "builds": {
    "main": { "root": ".", "adapter": "gradle", "java": "jdk21" }
  },
  "targets": {
    "fabric-1.21.1": {
      "minecraft": "1.21.1",
      "loader": "fabric",
      "build": "main",
      "tasks": {
        "inspect": ["harnessExport"],
        "build": ["build"],
        "unit": ["test"],
        "serverGameTest": ["runGameTest"]
      },
      "artifactManifest": "build/harness/fabric-1.21.1.json",
      "requiredSuites": ["unit", "server-gametest", "client-smoke"],
      "java": { "gradle": "jdk21", "toolchain": 21, "game": "jdk21" }
    }
  },
  "suites": {
    "unit": {
      "driver": "gradle",
      "task": "unit",
      "results": "build/test-results/test/TEST-example.CounterStateTest.xml",
      "minTests": 1
    },
    "server-gametest": {
      "driver": "gradle",
      "task": "serverGameTest",
      "results": "build/gametest-results.xml",
      "expectedTests": ["fixture.counterPersists"],
      "minTests": 1
    },
    "client-smoke": {
      "driver": "unsupported",
      "requiredCapabilities": ["real-client"]
    }
  },
  "runtimes": {}
}
```

`builds` には複数のビルドルートを指定できます。`target.build` はそのキーを参照します。`target.tasks` は任意の対応キーから Gradle タスクの配列へ対応させます。`suite.task` はその対応キーを参照し、Gradle のタスク名を直接指定する項目ではありません。Gradle オプションをタスク名として渡すことはできません。

Gradle Wrapper はルート内の `gradlew.bat` または `gradlew` を使用します。呼び出しには `--no-daemon --console=plain` を追加し、同じビルドルートの操作を直列化します。所有者不明の永続ロックを自動削除することはありません。クラッシュ後の `.harness/build-adapter.lock` は記録された所有者を確認して回収してください。

`GRADLE_USER_HOME` を明示した環境ではそのキャッシュを維持します。未設定の場合はプロジェクトの `.harness/cache/gradle/` を使用し、個人の既定 Gradle キャッシュを変更しません。

ビルドは `build` 対応を実行し、その後 `inspect` 対応があれば実行します。inspect タスクを宣言した場合は、その実行でマニフェストを生成し直す必要があります。inspect タスクを省略した場合は明示配置したマニフェストを利用できます。

Minecraft、ローダー、依存関係の版は Gradle 側で固定します。マニフェストの target・minecraft・loader が共有設定と一致しない場合は実行を止めます。対象版の API 調査には inspect の解決済み情報を利用してください。

`target.loaderVersion` を宣言した場合は解決済みマニフェストとも照合します。実クライアント準備でも同じ版を明示し、バックエンドの既定カタログとの差を記録します。`target.caseAliases` はローダー固有の検出 ID を共通 ID へ変換します。変換後の重複や期待 ID の不足は通常の Suite 判定で失敗になります。

複数ターゲットで同じ Suite 仕様を使う場合、`target.suiteBindings` へ `{ "multiplayer": { "runtime": "neoforge-server", "pilot": { "backend": "mc-pilot", "helper": "mct-helper-neoforge-1.21.1" } } }` のように接続先だけを指定できます。ケース ID・件数・Driver は共有 Suite を使用します。bind 先と固定ツールの参照は設定読み込み時に検証します。

## 成果物マニフェスト

`target.artifactManifest` はビルドルートからの相対パスです。ワイルドカードで JAR を選択する機能はありません。

```json
{
  "schemaVersion": 1,
  "target": "fabric-1.21.1",
  "minecraft": "1.21.1",
  "loader": "fabric",
  "loaderVersion": "0.16.14",
  "mappings": "yarn:1.21.1+build.3",
  "java": { "gradle": "jdk21", "toolchain": 21, "game": "jdk21" },
  "artifacts": [
    { "path": "build/libs/example-mod.jar", "kind": "distribution", "side": "both" },
    { "path": "build/libs/example-mod-sources.jar", "kind": "sources", "side": "both" }
  ]
}
```

`kind` は `distribution`、`runtime-dependency`、`sources`、`development`、配置 `side` は `client`、`server`、`both` です。ビルド接続では配布 JAR を少なくとも一つ要求し、sources・development・javadoc を示すファイル名を配布 JAR として扱いません。成果物は SHA-256 とサイズを記録したスナップショットへ保存します。同じ Adapter でビルドした後にファイルやマニフェストが変わった場合は、収集時に再ビルドを要求します。

ビルドルートと成果物のパスはルート内へ収まる相対パスを指定します。`..`、絶対パス、Windows ドライブ、予約名、外部へ解決されるシンボリックリンクは認めません。`build.root` の `.` は利用できます。`classpath`・`sources` は任意の調査用パス配列で、Gradle キャッシュなどの絶対パスも記録できます。その配列のファイルを暗黙にゲームへ配備することはありません。

## Suite と結果

`gradle` Driver は対応タスクを実行し、`results` の JSON または JUnit XML を読み込みます。結果ファイルは Gradle Suite ではビルドルート、process Suite ではその隔離セッションからの相対パスです。実行前に既存の結果ファイルを削除し、今回の処理による新しい結果を要求します。単一のファイルを指定する契約であり、結果ファイルの glob やディレクトリ集約はありません。

Gradle Suite では古い結果の削除、タスク実行、Run 内への結果スナップショット保存まで同じビルドルートのロックを保持します。評価には保存したスナップショットを使うため、後続の別 Run が共有ビルド出力を更新しても今回の結果に混ざりません。保存時に JSON・XML の構造を維持したまま資格情報を除去します。

JSON の最小形式は次のとおりです。

```json
{
  "schemaVersion": 1,
  "cases": [
    { "id": "fixture.counterPersists", "status": "passed", "durationMs": 20 }
  ]
}
```

ケースは `passed`、`failed`、`unsupported`、`skipped`、`infrastructure-error` を区別します。JUnit XML のケース ID は classname がある場合に `classname.name`、ない場合に name です。XML の tests 属性だけから検出数を推定しません。DOCTYPE を含む XML は拒否します。

`minTests` は正の整数で、未指定時にも少なくとも1件を要求します。`expectedTests` に宣言した ID はすべて実際に検出する必要があります。重複 ID、必須 Suite 内の未対応・未実行ケース、検出0件は不合格です。プロセスの終了コード `0` だけでは合格になりません。

JSON のケースには `attempts` として各試行の status・message を記録できます。前の試行が失敗し、最後に成功したケースは試行履歴を残したまま不合格として扱い、安定した成功へ昇格させません。

`unsupported` Driver は未検証・未実装の能力を明示するために使います。必須 Suite に含めたままで設定を読み込めますが、リリースゲートは成功しません。Suite の `requiredCapabilities` が Runtime の宣言と一致しない場合も未対応です。Gradle の既定能力は `gradle-task` と `test-results` です。

単一 Suite の開発中の実行は `mch test --target <id> --suite <id>` を使用します。Suite 未指定ではターゲットの必須 Suite を実行します。`mch test --all --profile release` は全ターゲットの必須 Suite を実行し、`--suite` による絞り込みを拒否します。必須 Suite が空の場合もリリース検証を実施したことにはなりません。

## プロセス実行構成

`process` Driver は明示された外部コマンドを起動して、新規に生成された結果ファイルを評価します。ゲームを起動した事実や実クライアント操作の成功を汎用プロセスの終了から推測しません。能力の宣言は実機で検証した範囲に合わせてください。

```json
{
  "suites": {
    "external-test": {
      "driver": "process",
      "runtime": "external",
      "results": "results.json",
      "expectedTests": ["fixture.external"],
      "requiredCapabilities": ["fixture-observation"]
    }
  },
  "runtimes": {
    "external": {
      "kind": "server",
      "capabilities": ["fixture-observation"],
      "command": {
        "executable": "node",
        "args": ["{projectRoot}/scripts/external-test.mjs", "{sessionRoot}/results.json", "{target}"]
      }
    }
  }
}
```

この例は共有設定へ加える断片です。command は executable と引数配列を分けて指定します。`{projectRoot}`、`{sessionRoot}`、`{runRoot}`、`{target}` は実行時に置換します。`MCH_PROJECT_ROOT`、`MCH_SESSION_ROOT`、`MCH_TARGET` も子プロセスの環境へ渡します。各 Suite の作業ディレクトリは `.harness/runs/<run-id>/sessions/<target>/<suite>/` です。

## 配布 JAR の専用サーバー起動確認

`server-smoke` Driver は配布成果物を隔離サーバーへ配置し、出力の準備完了パターンを期限付きで待ち、`stop` を送って正常終了を検証します。`results` は不要で、`server.ready` と `server.stopped` のケースを生成します。client-only 成果物、sources・development JAR はサーバーへ配置しません。

```json
{
  "suites": {
    "server-smoke": {
      "driver": "server-smoke",
      "runtime": "dedicated-server",
      "requiredCapabilities": ["dedicated-server"],
      "expectedTests": ["server.ready", "server.stopped"],
      "minTests": 2
    }
  },
  "runtimes": {
    "dedicated-server": {
      "kind": "server",
      "capabilities": ["dedicated-server"],
      "command": {
        "executable": "{java:game}",
        "args": ["-Xmx2G", "-jar", "{tool:fabric-server}", "nogui"]
      },
      "readyPattern": "Done \\("
    }
  }
}
```

この断片を共有設定へ加え、対象の requiredSuites に server-smoke を追加します。`{java:game}` は対象の Java game 参照から実行ファイルを解決します。`{tool:<key>}` は lock に固定したツールを参照し、local.tools に絶対パスがあればそのファイルを、なければ lock.url の HTTPS URL を使用します。使用前に SHA-256 を検証します。これらのプレースホルダーは現在 server-smoke の command で利用でき、単独の引数として指定します。`{sessionRoot}` と `{port}` も server-smoke の command で置換できます。

Forge・NeoForge のインストーラーは Runtime の `setup` に Java コマンドを指定します。隔離セッション内で setup が成功してから command を起動し、準備失敗・キャンセルのログも保存します。`{os}` は `win` / `unix` に展開し、固定ローダー版の引数ファイルを指定できます。クライアント操作 Suite も同じ専用サーバー Runtime を使用します。

lock の tools エントリは `version` と64桁の `sha256` を必須とし、必要に応じて `url` を指定します。`latest` のような可変版は拒否します。版とハッシュは実際に取得した固定ファイルの値を記録してください。ダウンロードには排他ロックと512 MiB の上限を設け、不正なキャッシュを暗黙に再利用しません。

local に追加する例は `{ "tools": { "fabric-server": "C:\\MinecraftTools\\fabric-server-fixed.jar" } }` です。local の tools キーには同名の lock エントリが必要です。サーバーセッションは loopback、固有ポート、seed `8675309`、flat world、creative を使用します。server.properties と配備した成果物の session.json を保存します。オンライン認証を要求しない隔離サーバー構成はローカル検証用です。

## ローカル Java と期限

```json
{
  "schemaVersion": 1,
  "java": {
    "jdk17": "C:\\Java\\jdk-17",
    "jdk21": "C:\\Java\\jdk-21"
  },
  "timeouts": { "build": 600000, "start": 120000, "test": 120000, "stop": 5000 },
  "eulaAccepted": true
}
```

Java の値は Java home の絶対パスです。Linux では `/opt/jdk-21` のように指定します。target.java.gradle は build.java より優先し、Gradle の `JAVA_HOME` へ渡します。toolchain はコンパイル条件の宣言、game はゲーム起動用 Java の参照です。Gradle の toolchain 設定自体を書き換える機能はありません。

Java のローカル参照先が未配置でも共有設定は読み込めます。`doctor` と実際の Adapter 実行で環境不足を報告します。EULA に同意した環境をテストサーバーへ再利用する場合にのみ eulaAccepted を true にします。ローカルの個人用 `.minecraft` を使わず、隔離セッションを使用します。

Gradle の Java toolchain 探索には local.java の home 一覧を渡します。Gradle 用 Java とゲーム用 Java を別々に選択でき、共有ビルド設定のコンパイル条件は維持します。fixture の GameTest は CLI が渡す `MCH_EULA_ACCEPTED=true` のときだけ、同意を隔離した実行ディレクトリへ再利用します。Gradle を直接実行する場合は同意済みの `eula.txt` または同じ環境変数を用意してください。

期限はミリ秒の正の整数です。既定のビルド期限は600秒、Gradle Suite と process Suite のテスト期限は120秒、process Suite の停止猶予は5秒です。ビルド・inspect には build、Suite のタスク実行には test の期限を使用します。server-smoke の既定の準備完了期限は120秒、セッション全体は300秒、停止猶予は10秒です。process Driver は処理が終了して結果を生成する契約であり、readyPattern による準備完了待機や永続サーバーの正常停止には server-smoke を使用します。

## 証拠と再現

Run の `report.json` と `junit.xml` は `.harness/runs/<run-id>/` に保存します。成果物・Suite ログの参照は Run ディレクトリからの相対パスです。終了コードは成功 `0`、不合格 `1`、設定・環境不足 `2` です。JSON 出力の標準出力には一つの JSON オブジェクトだけを出し、進捗は標準エラー、子プロセス出力はログファイルへ保存します。

設定・lock・ターゲット・成果物ハッシュ・解決済み情報・ケース結果・Git リビジョンと差分ハッシュを記録します。資格情報を示すキーや文字列は JSON と JUnit の保存前に除去します。local の Java パスや同意状態を共有設定スナップショットへ混ぜません。

追跡済みソースの未コミット差分はハッシュで識別し、資格情報を除去した `source.patch` を保存します。未追跡ファイルはパスと内容ハッシュの一覧で識別し、内容自体は保存しません。再実行に必要なソースやローカル環境が不足する場合は `reproduction.limitations` に示します。

スキーマは `schemas/harness.config.schema.json`、`schemas/harness.local.schema.json`、`schemas/harness.lock.schema.json`、`schemas/artifact-manifest.schema.json`、`schemas/run.schema.json` に同梱しています。CLI は設定に JSON Schema 検証と参照・パスの意味検証を適用します。
