# 検証状況

検証した実行結果に基づいて更新する。ロード可能な設定を持つことだけで対応済みとはしない。

| 対象 | 環境 | 状況 |
| --- | --- | --- |
| 全ハーネス契約 | Windows / Node 24.19.0 | 123件中121成功・OS固有2件skip、失敗0。設定・明示成果物・パス・プロセス・Gradle・CLI・判定・レポート・導入・バックエンド改変・証拠回収 |
| 全ハーネス契約 | WSL Ubuntu 24.04.3 / Node 24.19.0 | 同じ123件中115成功・OS固有8件skip、失敗0。ダミー Wrapper / backend の契約は実ゲーム成功とは別 |
| fabric-1.21.1 / Fabric 0.16.14 | Windows / Java 21.0.5 / Gradle 8.10 / mc-pilot 0.15.0 | 全6必須 Suite・22ケース成功 |
| 意図的同期・起動不具合 | Windows / Fabric 1.21.1 | 実ゲームで不合格・準備完了失敗を検出。正常系の成功へ混在しない |
| neoforge-1.21.1 / NeoForge 21.1.252 | Windows / Java 21.0.5 / Gradle 9.2.1 / mc-pilot 0.15.0 | 全6必須 Suite・22ケース成功 |
| fabric-1.20.1 / Fabric 0.16.14 | Windows / Gradle Java21.0.5・コンパイルとゲーム Java17.0.10 / Gradle8.10 / mc-pilot 0.15.0 | 全6必須 Suite・22ケース成功 |
| forge-1.20.1 / Forge 47.3.0 | Windows / Java 17.0.10 / Gradle 8.8 / mc-pilot 0.15.0 | 全6必須 Suite・22ケース成功 |
| fabric-1.21.1 / Fabric 0.16.14 | WSL Ubuntu 24.04.3 / WSLg / Java 21.0.8 / Gradle 8.10 / mc-pilot 0.15.0 | 全6必須 Suite・22ケース成功 |
| neoforge-1.21.1 / NeoForge 21.1.252 | WSL Ubuntu 24.04.3 / WSLg / Java 21.0.8 / Gradle 9.2.1 / mc-pilot 0.15.0 | 全6必須 Suite・22ケース成功 |
| fabric-1.20.1 / Fabric 0.16.14 | WSL Ubuntu 24.04.3 / WSLg / Gradle Java21.0.8・コンパイルとゲーム Java17.0.16 / Gradle8.10 / mc-pilot 0.15.0 | 全6必須 Suite・22ケース成功 |
| forge-1.20.1 / Forge 47.3.0 | WSL Ubuntu 24.04.3 / WSLg / Java17.0.16 / Gradle8.8 / mc-pilot 0.15.0 | 全6必須 Suite・22ケース成功 |
| 配布物からの新規 Windows プロジェクト | Java 17 / Fabric 1.20.1 | 固定 backend 導入から全6必須 Suite・22ケース成功。Run `2026-09-30T10-45-57-991Z-55e87251`。深い native DLL パスで失敗した旧 Run も保持し、短い物理コピーで解決 |
| GitHub Actions / Xvfb | Ubuntu 24.04 設定 | workflow・固定環境・証拠回収の構成検証済み。GitHub上の実ゲーム実行は未検証 |

実証した固定版 mc-pilot 0.15.0 をクライアント操作に採用する。サーバーはハーネスが所有する。クライアント停止時の PID・ポート所有範囲は [バックエンド調査](backends/mc-pilot.md) を参照する。

Windows の共通 `mch test --all --profile release` は Run `2026-09-30T11-15-49-173Z-4eddbbf5`、全4ターゲット・24 Suite・88ケース成功です。各22ケースは unit2 / server-gametest2 / server-smoke2 / client-smoke3 / multiplayer6 / multi-client7です。実行する managed backend の全ファイルを起動前に照合し、実 tree SHA-256 を記録しています。

Linux の同じ共有設定による全必須実行は Run `2026-09-30T11-19-12-322Z-c975034a`、全4ターゲット・24 Suite・88ケース成功です。Windows と同じ共通ケース ID を使い、各 OS の依存 lock と local Java role・画面環境を記録しています。POSIX Wrapper の Java 17 探索に失敗した旧 Run `2026-09-30T10-44-21-934Z-5d2d16b6` は別の不合格記録として保持し、修正後の成功と混在させません。両 OS の固定 backend tree SHA-256 は `0109ba38a247b4125b249d015fdd6d25dc667752eb1022607ee55312e8f43a5a` で一致します。

外部サービスへの npm 公開は行わない。Minecraft 本体、ゲーム実行状態、認証情報、開発者のキャッシュを npm 配布物へ含めない。
