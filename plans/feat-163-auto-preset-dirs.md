# feat: 起動 dir を自動 preset 化し Settings の Directory presets を撤去 (#163)

## User Prompt

> grid view で terminal を起動するときの dir は設定で追加している。でも、これは本当は開くときに指定した dir を勝手に追加していけば良いね。で、preset の削除も簡単にできるようにする。そうすれば設定部分を削除できるね？

## 調査で判明した前提（重要）

main には既に2系統が併存:
- **手動 presets** (`CwdPreset {label,path}`、server `config.json` の `cwdPresets`、Settings → Directory presets で編集)。
- **自動 recentDirs** (`useRecentDirs`、localStorage `recent_dirs_v1`、最大4・MRU・dedup、`onServerCwd→recordDir(サーバ確定cwd)` で自動記録、表示は `formatCwd`)。✕削除は無し。

ユーザーが見ている `feat/confirm-before-close` は recentDirs 以前のブランチのため presets しか見えていなかった。よって本タスクは「ゼロから自動追加を作る」ではなく **2系統の統合**。

## 決定事項

- **統合先ストレージ**: server `config.json` の `cwdPresets`（永続・端末間共有・既存データ流用）。localStorage の `recentDirs` は廃止。
- **自動追加**: フレッシュ起動のサーバ確定 cwd (`onServerCwd`+`recordNextCwd`) を `cwdPresets` に追加。
- **label**: dir の basename（worktree は `cwdDisplay.worktreeLabel` の `repo (task)`）。手動ラベルUIは廃止。
- **上限**: なし。dedup（既存パスは何もしない＝位置保持）、新規は先頭に追加。
- **削除**: 起動フォームの各チップに ✕ を付与し即削除。
- **Settings**: Directory presets セクションを撤去（Theme / Notification sound は残す）。

## 実装

### データ/ロジック
- `src/composables/useAppConfig.ts`: `recordPreset(path)` / `removePreset(path)` を追加（既存 POST `/api/config {cwdPresets}` を流用、dedup・先頭追加・上限なし）。settings 用 `savePresets` は内部化。
- `src/components/presets.ts`: `presetLabel(path)` を追加（basename / worktree-aware）。

### グリッド経路（自動記録・✕）
- `src/components/TerminalCell.vue`:
  - `useRecentDirs` 撤去、`.cell-recents` 行を撤去。
  - 統合チップを `presets` から描画（本体=fill+launch `selectPreset`、末尾=fill only `fillDir`、新規 ✕=`emit('remove-preset', path)`）。
  - `dirInput` 既定を `initialCwd ?? presets[0]?.path ?? defaultCwd`。
  - `onServerCwd`: `recordDir(c)` を `emit('record-cwd', c)`（`recordNextCwd` gate 維持）に置換。emits に `record-cwd` / `remove-preset` 追加。
- `src/components/TerminalGrid.vue`: `@record-cwd` / `@remove-preset` を中継。
- `src/components/GridView.vue`: `@record-cwd="recordPreset"` / `@remove-preset="removePreset"`、SettingsModal の `:presets/@save` を撤去。

### Settings 撤去
- `src/components/SettingsModal.vue`: Directory presets セクション（props.presets / rows / addRow / removeRow / save / dirty / フッタの Save）を撤去。Theme + Sound のみ（即時適用）。フッタは Close のみ。
- `src/App.vue`: SettingsModal の `:presets/@save` 撤去、未使用になる `presets`/`savePresets` を整理。

### 廃止
- `src/composables/useRecentDirs.ts` と `useRecentDirs.spec.ts` を削除。

## テスト / 検証
- vitest: `useAppConfig` の recordPreset(dedup/先頭追加/上限なし)/removePreset、`presetLabel`、TerminalCell の record-cwd/remove-preset emit、SettingsModal から presets セクションが消えたこと。recentDirs spec 削除。
- `typecheck`(vue-tsc) / `lint` / `build` / Playwright で起動→自動チップ追加→✕削除→Settingsにpresets無しを実機確認。

## 後方互換
- 既存 `cwdPresets`(手動ラベル付き)はそのまま動作・✕付与。サーバAPIは無変更。データ移行不要。
