# fix: #748 worktree 系 follow-up（worktree-diff / worktree-pr / worktrees）

## User Prompt

> mulmoclaude で全ファイルをレビューして…（略）バグを issue 化し、順に対応・CI・レビュー対応・マージまで進める

#748 の軽微バグまとめのうち、worktree 系3件は #743(PR #754) が同じファイルを触っていたため
競合回避で deferred にしていた。#754 マージ後に実施する follow-up。

## 3件

### 5. `worktree-diff.ts` — 裸リビジョンの曖昧さ
`git diff <base>` は、worktree にベースブランチと同名のファイル（例: `main` という名のファイル）が
あると "ambiguous argument: both revision and filename" で失敗し、diff が空になる。
`changedFiles`（numstat）と `diffPatch` の両方に `--`（`REV_END`）を付けて曖昧さを解消。

### 6. `worktree-pr.ts` — PR 再作成で既存 PR ではなく compare ページを開く
PR が既存だと `gh pr create` が失敗し、compare ページ（新規 PR 作成画面）にフォールバックしていた。
作成失敗時に `gh pr list --head <branch>` で既存 PR を検索し、あればその URL を返す（`parsePrUrl` 再利用）。

### 7. `worktrees.ts` — `removeWorktree` の非正規化パス比較で deleteBranch がスキップ
ブランチ検索が `w.path === path.resolve(worktreePath)` で、git は realpath を報告する（macOS /tmp→/private/tmp）
ため、入力パスが realpath 化されていないと一致せず branch が null になり、`deleteBranch` が黙ってスキップされる。
`isManagedWorktree` と同じ `canonicalPath` で両辺を正規化して比較。

## テスト

- `worktree-diff.spec.ts`: ベースブランチと同名ファイル（`main`）を含む worktree の diff が空にならず file を報告。`--` を外すと赤。
- `worktree-pr-timeout.spec.ts`: `gh pr create` 失敗時に既存 PR url を返す / 新規作成 url を返す。既存検索を削ると赤。
- `worktrees.spec.ts`: 既存の removeWorktree テストに「branch が実際に削除された」assertion を追加。branch lookup を null 固定にすると赤。

全 3574 テスト + typecheck(server/test) + lint + build パス。
