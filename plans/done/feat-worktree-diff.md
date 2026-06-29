# feat: worktree 差分の可視化（Slice 1 of 取り込み導線）

Issue: #110（Umbrella #108 / 取り込み・最優先）

## スコープ（このPR = read-only）
worktree セルが「base ブランチに対してどれだけ変わったか」を見せる。**push / PR などの mutation は Slice 2（別PR）**。

## サーバ
- `server/worktree-diff.ts`（新規）: `worktreeDiff(cwd)` → `{ isWorktree, base, ahead, dirty, files, patch, truncated }`。
  - `git` ランナーは `worktrees.ts` から再利用（DRY のため export 化）。
  - base = `defaultBaseBranch(repo)`（作成時に fork した元）。非 worktree / 非 git は `isWorktree:false`。
  - `ahead` = `rev-list --count base..HEAD` / `dirty` = porcelain 行数 / `files` = `diff --numstat base` ＋ untracked（`ls-files --others`）/ `patch` = `git diff base`（200k 文字で truncate）。
- `server/worktree-routes.ts`: `GET /api/worktrees/diff?cwd=` を追加（read-only なので origin ガード無し、list と同じ）。
- spec: `worktree-diff.spec.ts`（engine）, `worktree-routes.spec.ts`（route の非worktree応答）。

## フロント
- `TerminalCell.vue`:
  - launch / resume / 作業が settle（working→false）したタイミングで `loadDiff()`。
  - ヘッダに `+<ahead> ●<dirty>` バッジ（counts>0 のとき）。クリックで diff パネル。
  - diff パネル = ターミナル領域へのオーバーレイ。変更ファイル一覧（+/-、untracked は `new`）＋ `git diff` パッチ（`<pre>`）。read-only。✕/Esc で閉じる。
- spec: `TerminalCell.spec.ts`（バッジ表示・パネル開閉・clean/非worktree で非表示）。

## 非対象（Slice 2）
ブランチ push / PR作成（gh）/ remote・gh 無しのフォールバック。
