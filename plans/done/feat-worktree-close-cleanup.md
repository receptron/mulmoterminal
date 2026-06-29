# feat: worktree セルの close 時クリーンアップ

Issue: #118（Umbrella #108 / 自動 cleanup）

## スコープ（close 時のみ）
worktree セルを ✕ で閉じるとき、**部屋を残す / 撤去** を選べる確認オーバーレイを出す。未保存（dirty/ahead）があれば警告し、黙って消さない。

## 実装（`TerminalCell.vue`）
- `close()` のテアダウン本体を `teardown()` に分離。
- `close()`: worktree セル（`isWorktreeCell`）なら `closeConfirm=true`＋`loadDiff()`（警告用に dirty/ahead 更新）。非 worktree は即 `teardown()`（従来どおり）。
- 確認オーバーレイ `.cell-close-confirm`:
  - **Keep worktree** → `teardown()`（部屋は残る、ランチャから再利用可）。
  - **Remove worktree / Discard & remove** → `removeAndClose()`: terminate（Windows の cwd ロック対策）→ `POST /api/worktrees/remove {repoDir:cwd, path:cwd, deleteBranch:true, force:true}` → `teardown()`。
  - **Cancel** → オーバーレイを閉じてセッション継続。
- 未保存（`dirty>0 || ahead>0`）で警告文＋ボタンを **Discard & remove**、clean なら **Remove worktree**。
- remove は cwd（worktree パス）を repoDir/path 両方に渡す（サーバが `repoRoot` で本体解決）。サーバ変更なし。

## テスト（`TerminalCell.spec.ts`）
worktree close で確認表示／非 worktree は即 close／Keep は remove せず／Remove は force remove を POST／Cancel でセッション継続／未保存警告と Discard ラベル。

## 非対象（フォロー）
マージ/PR 検知後の自動撤去、stash、node_modules 戦略。
