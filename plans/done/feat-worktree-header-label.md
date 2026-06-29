# feat: worktree セルのヘッダを「レポジトリ名（worktree名）」表示に

Umbrella: #108（表示タスク）

## 背景
worktree セルのヘッダは今 `~/.mulmoterminal/worktrees/<repo>-<hash>/<task>` という管理パスをそのまま出していて長く・意味が薄い。どのリポのどの作業部屋かが一目で分かる表示にする。

## 変更
- `src/components/cwdDisplay.ts`: 純粋関数 `worktreeLabel(cwd)` を追加。管理 worktree パス（`.../worktrees/<repo>-<8hex>/<task>`）から `{ repo, task }` を取り出す。非該当は `null`。
- `TerminalCell.vue`: ヘッダの dir スロットを `headerDir` computed に。worktree なら `⎇ <repo> (<task>)`、それ以外は従来の `formatCwd`。hover の title はフルパス（`Open <cwd>`）のまま。
- テスト: `cwdDisplay.spec.ts`（managed/非managed/Windows/dash入りrepo/task欠落）、`TerminalCell.spec.ts`（worktree セルのヘッダ表示）。

## 非対象
ブランチ表示（`⎇ agent/<task>`）や ahead/dirty インジケータは #108 の別タスク。ここは「dir → repo(task)」の表示だけ。
