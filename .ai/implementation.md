# 実装作業と境界

計画のフェーズ順を守り、実機未確認の能力を対応済みとしない。
`.ai/` は作業記録。製品コード・同梱文書から依存しない。main に統合する際は除外する。

## 並列作業

1. core agent: `src/core/types.ts`, `src/core/config.ts`, `schemas/`, 設定契約テスト。
2. platform agent: `src/platform/`, プロセス契約テスト。
3. gradle agent: `src/adapters/build/`, ビルド契約テスト。
4. root: パッケージ、CLI、Run/報告、統合、実機接続、配布検証。

## 共通契約

ESM TypeScript / Node 24。ソースのimportは `.js`、テストは Node の型消去で `.ts` を直接import可。

`loadConfig(projectRoot: string): Promise<LoadedConfig>`。
LoadedConfig は `root: string`, `config: HarnessConfig`, `local: LocalConfig`, `lock: HarnessLock`。
config は schemaVersion 1, projectId, builds, targets, suites, runtimes。
builds[id]: root, adapter:'gradle', java? (role key)。
targets[id]: minecraft, loader, build, tasks: Record<string,string[]>, artifactManifest, requiredSuites:string[], java?: {gradle?:string,toolchain?:number,game?:string}。
suites[id]: driver:'gradle'|'process'|'unsupported', task?:string, requiredCapabilities?:string[], expectedTests?:string[], minTests?:number, results?:string, runtime?:string。
runtimes[id]: kind:'server'|'client'|'multiplayer', capabilities:string[], command?: {executable:string,args:string[]}, readyPattern?:string。
local: schemaVersion 1, java?:Record<string,string>, timeouts?:{build?:number,start?:number,test?:number,stop?:number}, eulaAccepted?:boolean。
lock: schemaVersion 1, tools:Record<string,{version:string,sha256:string,url?:string}>。

`runProcess(options): Promise<ProcessResult>` in `src/platform/process.ts`。
options: executable, args:string[], cwd, env?, timeoutMs, logDir, signal?, gracefulInput?, stopTimeoutMs?。
result: status:'passed'|'failed'|'timed-out'|'cancelled'|'infrastructure-error', exitCode:number|null, signal:string|null, durationMs:number, stdout:string, stderr:string, logs:{stdout:string,stderr:string}, error?:string。
`gradleCommand(buildRoot, tasks, platform?): {executable,args}` in `src/platform/gradle.ts`。

`GradleBuildAdapter` in `src/adapters/build/gradle.ts`, constructed with LoadedConfig。
`inspect(targetId, {logDir,signal?}): Promise<BuildOutcome>` / `build(targetId, {logDir,signal?}): Promise<BuildOutcome>` / `runTasks(targetId, taskKey, {logDir,signal?}): Promise<ProcessResult>` / `collectArtifacts(targetId,destination): Promise<Artifact[]>`。
BuildOutcome: status (ProcessResult status), process?:ProcessResult, artifacts:Artifact[], manifest?:ArtifactManifest, error?:string。
manifest: schemaVersion:1,target,minecraft,loader,loaderVersion?,mappings?,java?:{gradle?:string,toolchain?:number,game?:string},artifacts:Array<{path,kind:'distribution'|'runtime-dependency'|'sources'|'development',side:'client'|'server'|'both'}>,classpath?:string[],sources?:string[]。
Artifact returned after collection: path (relative to destination), sha256, size, kind, side, originalPath。

All invalid settings throw useful errors. JSON stdout remains clean. Gradle output goes to files, never CLI stdout. No wildcard JAR selection or claimed real game passes from dummy processes.
