# feat #242 — 常時ステータスヘッダ（git branch / dirty / ahead·behind）

Umbrella #241 の子。ターミナルヘッダに git の状態を常時表示し、`git status` の打ち直しを減らす。

## スコープ（このPRのMVP）

- **サーバ**: `GET /api/git-status?cwd=` → `{ repo, branch, detached, dirty, ahead, behind, upstream }`。
  非 git dir は `repo:false`（エラーにしない）。`server/worktrees.ts` の共有 `git()` ランナーを再利用。
- **クライアント**: 単一ビュー（`Terminal.vue`）とグリッドセル（`TerminalCell.vue`）のヘッダに
  ブランチチップ（`⎇ branch ●dirty ↑ahead ↓behind`）を表示。
- 取得タイミング: マウント時 / cwd 変更時 / ウィンドウ focus 時 / 一定間隔（10s, 可視時のみ）。
  さらにグリッドセルはターン完了で `loadDiff()` を呼ぶ箇所に相乗りして即時更新。

## 設計判断（issue の要判断への回答）

- **更新トリガ**: focus + 可視時の 10s ポーリング + cwd 変更。軽量なので許容。将来 file-watch に置換可。
- **表示項目**: branch / dirty / ahead·behind（upstream 有時）。**venv / container / ssh は本PRでは対象外**（フォローアップ）。
- **worktree セルとの重複回避**: worktree セルには既存の diff バッジ（ahead/dirty vs base）があるため、
  チップは **dirty を出さず branch 名のみ**（`hideDirty`）。ahead/behind は upstream 基準なので
  新規 agent ブランチでは通常 0 → 何も出ない。

## ファイル

- `server/git-status.ts` — `gitStatus(cwd): Promise<GitStatus>`（純関数、テスト可能）
- `server/git-status.spec.ts` — 一時 git repo で branch/dirty/ahead を検証（`worktree-diff.spec.ts` 準拠）
- `server/index.ts` — `GET /api/git-status`（`resolveWorkspace` で cwd 解決、既存 GET 群に倣う）
- `src/composables/useGitStatus.ts` — `useGitStatus(cwd: Ref)` → `{ status, refresh }`
- `src/components/GitBranchChip.vue` — チップ表示（両ビューで再利用、props: `status`, `hideDirty`）
- `Terminal.vue` / `TerminalCell.vue` — ヘッダにチップを差し込み

## 非スコープ / フォローアップ

- venv / container / ssh インジケータ
- ファイル変更 watch への置換（現状はポーリング）
- 非worktree dir の「ライブ diff」統合（#242 とは別、既存 worktree-diff の一般化）
