# feat-182: セルランチャーで起動コマンドを選べる

Issue: #182

## 決定事項（ユーザー確認済み）
- **方式 A**: 設定駆動の「起動ランチャー一覧」（`launchers: [{label, command}]`）を Settings で編集（`prRepos` と同じ要領）。ランチャーに Claude と横並びで表示。
- **非 Claude セル**: 持続 PTY ＋ 再接続（グリッドのページ切替で生存）。状態は **running / idle のみ**（claude の hook 由来 blocked/done は無し）。

## アーキテクチャ方針
持続・再接続のライフサイクル（`ptys` map ＋ `reattachPty` ＋ `reap` ＋ `handleClientClose` の grace）は **claude と共通で流用可能**。claude 固有なのは spawn（`buildClaudeArgs`/hooks/resume）だけ。よって launcher 用に **spawn だけ差し替えた並行パス**を足す。

## 変更ファイル

### サーバ
- `server/app-config.ts`: `Launcher = {label, command}`、`AppConfig.launchers`、`sanitizeLaunchers()`（trim・空除外・長さ/件数上限・label 重複除去）、load/save 反映。
- `server/config-routes.ts`: GET/POST に `launchers`、`getLaunchers()` live-read。
- `server/index.ts`:
  - `resolveLauncher(index)` — `getLaunchers()[index]`（allowlist、browser は index のみ送る）。
  - `spawnLauncherPty(sessionId, ws, command, cwd)` — 持続 PTY。hook 無し。`$SHELL -lc "exec <command>"`（Windows は powershell）で単一の対話プロセスとして常駐。`ptys` 登録、onData でバッファ＋中継、onExit で exit 送信 → `reap`。
  - `/ws/launch` WS（`runLaunchWss`）: `?session`（再接続）`?cwd` `?launcher=<index>`。live あれば `reattachPty`、無ければ `spawnLauncherPty`。`markDevTerminalSession`（sidebar 除外）。`handleClientFrame` / `handleClientClose` を流用（grace で持続）。

### クライアント
- `src/components/wsUrl.ts`: `buildLaunchWsUrl({host, secure, sessionId, cwd, launcher})` → `/ws/launch?session&cwd&launcher`。
- `src/composables/useTerminalConnections.ts`: `ConnTarget.launcher: {index}|null`、`connect()` の URL 分岐に launcher を追加（`command` と違い**再接続する**＝持続）。
- `src/components/Terminal.vue`: `launcher` prop、`currentTarget()` に反映。
- `src/components/LauncherCell.vue`（新）: CommandCell 型だが**持続**（session あり・`persistKey`・再接続）。ヘッダに label・状態ドット（running/idle）・閉じる/拡大/移動。`@session` で id を親に persist、`@exit` で idle。
- `src/components/gridTabs.ts`: `Cell.launcher: {index, label}|null`、`launchInCell()` transform、`isOccupied`/直列化（launcher セルを persist）、`runningCount` に算入。
- `src/components/TerminalGrid.vue`: `cell.launcher` のとき `<LauncherCell>` を描画・配線。`launchers` を下流へ。
- `src/components/TerminalCell.vue`: 空セルランチャーに「or launch」ボタン群（設定 launchers）。クリックで `launch-program({index, label, cwd})` を emit（親が cell.launcher をセット）。
- `src/composables/useAppConfig.ts`: `launchers` singleton ＋ `saveLaunchers()`。
- `src/components/SettingsModal.vue` ＋ `App.vue` / `GridView.vue`: launchers 編集の配線。

### テスト
- `server/app-config.spec.ts`: `sanitizeLaunchers` / launchers 往復。
- `src/components/wsUrl.spec.ts`: `buildLaunchWsUrl`。
- `src/components/gridTabs.spec.ts`: `launchInCell` ＋ launcher セルの直列化/復元。

## ゲート / 確認
typecheck(client/server)/format/lint/build/test。実 PTY で shell / codex 起動と再接続を目視確認。
