# 実装進捗

計画: plan.md。作業記録は main のマージ対象にしない。

## フェーズ1 完了

- TypeScript 契約・JSON Schema・厳密な設定検証・doctor/targets/inspect/build/test/report。
- 明示成果物・SHA256 スナップショット・Gradle/ソース切替ルートの排他。
- Windows Job Object / Linux プロセスグループ、正常終了・異常終了・期限・キャンセル・子孫回収。
- テスト結果の削除/実行/収集を同じ排他内に収める。JUnit/JSON の検出0件・期待ID・再試行履歴・未対応のゲート。
- Windows 実行済み。Linux 契約テストも実行中。

## フェーズ2 完了

- Fabric 1.21.1 fixture の配布 JAR ビルド、JUnit 2件、実サーバー GameTest 2件に成功。
- CLI Run 2026-09-30T07-42-18-256Z-67731e54: unit/server-gametest/server-smoke が成功。
- mc-pilot0.15.0 実測: 公開 npm と HEAD の Windows 実装・補助Mod取得に差分あり。所有範囲を制限した明示的 broker overlay が必要。採用根拠は製品 docs/backends/mc-pilot.md に記録。
- 実クライアント配置→専用サーバー参加→実操作による fixture 設置/使用→GUI→サーバー/クライアント/GUI counter 同期→再接続保存を PoC で確認。
- 証拠: .harness/multiplayer-poc-1790755489509。前の失敗も別ディレクトリへ保存。
- CLI release Run 2026-09-30T08-30-33-160Z-5d50e44c: unit2/server-gametest2/server-smoke2/client-smoke3/multiplayer6、全15ケース成功。
- 補助Modなしの実配布クライアント参加を確認。独立した同期障害・初期化例外は成功にならず、証拠保存・後始末も確認。
- 次: フェーズ3 NeoForge 1.21.1 fixture と複数クライアント。

## 後続フェーズ

NeoForge、1.20.1、4ターゲット・テンプレートはフェーズ2の完了後。
Linux 契約 CI、npm pack、同梱 Skills と更新保護、既存プロジェクト設定例は前提に依存しない部分を先行実装。
実 npm 公開は未実行。

## フェーズ3 完了

- NeoForge21.1.252 / Gradle9.2.1 / Java21 fixtureを共通ケースへ接続。
- CLI release Run 2026-09-30T09-15-37-955Z-eccd7cce: unit2/GameTest2/server2/client3/multiplayer6/multi-client7、全22ケース成功。
- Fabric/Neo実重複を共通Gradle exporterへ整理。宣言/解決版を照合。
- fixture driverの実証済みtarget限定capabilitiesとdoctor/runner事前検証。
- 2client正常・同期障害・キャンセルを実検証。所有server/ws全port閉鎖。

## フェーズ4 進行

- Fabric1.20.1: Java役割分離、unit2/GameTest2、実配布client3/multi6/multi-client7成功。CLI全ゲートは後続。
- Forge1.20.1: Forge47.3.0 / ForgeGradle6.0.36 / Gradle8.8 / Java17、unit2/GameTest2成功。配布runtime検証進行。
- 純粋Javaとunitをfixtures/commonへ共有、4rootのAPI差は独立。Stonecutter未採用の根拠 docs/architecture.md。
- Linux契約94件中93pass、Windows-only1skip。実gameはasset取得失敗ログ保持し診断中。

## フェーズ4 完了 / 配布再現

- Windows shared CLI all release Run 2026-09-30T10-32-20-564Z-400f63a2: 4 target / 24 Suite / 88 cases 全成功。
- 4 independent builds / Java roles / common pure Java / exact loader pins / capability registry / exporter / 移植手順完了。Stonecutterは今回未採用。
- Windows contract122件中120pass2OSskip、Linux122件中114pass8OSskip、fail0。
- npm packを別directoryへinstallし、固定tools・同梱fixture/settings/skillsからFabric1.20.1 full22 PASS Run2026-09-30T10-45-57-991Z-55e87251。個人cache/source依存なし。
- deepWindows native pathは短いowned physicalcopy＋SHA確認で解決。強制終了copyはexactownership確認後回収、旧failure evidence保持。
- Linux all4実build/unit8/GameTest8でLinux OS-specific strictlocks生成、同sharedconfig allrelease統合進行。

## フェーズ5・6 完了 / 最終検証

- 最終版 Windows shared CLI all release Run 2026-09-30T11-15-49-173Z-4eddbbf5: 4 target / 24 Suite / 88 cases 全成功、JUnit88一致・222相対証拠・6成果物hash検証。所有32port閉鎖、16記録PID終了、16native一時copy削除。
- 最終版 WSL Ubuntu24.04.3 / WSLg CLI all release Run 2026-09-30T11-19-12-322Z-c975034a: 同じshared config/lock、4 target / 24 Suite / 88 cases 全成功。JUnit/schema・212相対証拠・6成果物hash検証。所有32port閉鎖・Java/Node残存0・token-owned tmp削除。
- Linux旧Run2026-09-30T10-44-21-934Z-5d2d16b6はFabric1.20.1 Java17 discovery failureで不合格として保持。POSIX shellがdotted envを除去する問題を明示Gradle -P引数で修正、空白/日本語JDKとenv無効Wrapper回帰12件を両OSで成功、最新all88で実証。
- 最新契約123: Windows121pass2OSskip、Linux115pass8OSskip、fail0。両OSが同じ固定managed backend tree SHA0109ba38a247b4125b249d015fdd6d25dc667752eb1022607ee55312e8f43a5aを検証。
- npm pack別directory導入241files全byte一致、.ai/cache/game/local混入0、同shared config/template一致、bin/doctor/4skills再導入確認。実ゲーム検証済み候補の230実装filesと最終版のhash一致。
- 新規同梱projectのFabric1.20.1全22成功に加え、Gradle-P修正後のpacked CLI unit2/GameTest2を独立検証。外部local pathは承認済Javaのみ、backend/cacheは新規project内。
- CI固定Node/JDK、Xvfb/Mesa、画面環境内doctor、選択/全release、成功/失敗/中断時bounded evidence収集を整備。YAML/同梱copy/中断収集の両OSテスト済。GitHub/Xvfb上の実ゲームは未実行で、WSLg実績から成功を推定しない。
- 4 fixture/共通Java/OS別strictlock/既存project接続/4skills/導入更新/ライセンス表示/サポート一覧を同梱。npm公開は公開名・公開先・ライセンス確定後。.aiは配布物から除外、mainへのmergeなし。
