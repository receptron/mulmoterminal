# feat: worktree の取り込みアクション（push / PR）— Slice 2 of 取り込み導線

Issue: #110（Umbrella #108 / 取り込み・Slice 2）

## スコープ
diff パネル（Slice 1, #111 merged）に **outward-facing アクション**を足す。

- **Push branch**: `git push -u origin <worktree branch>`
- **Open PR**: push してから、**`gh` があれば `gh pr create`**、無ければ **GitHub の compare URL をブラウザで開く**（ユーザー選択 = 両方）。

## サーバ
- `server/worktree-pr.ts`（新規）:
  - `pushWorktree(cwd)` → `{ ok, branch }` / `{ ok:false, reason }`（not-worktree / no-branch / no-remote / failed）。
  - `createOrOpenPR(cwd)` → push 後に `gh pr create --base <base> --head <branch> --fill`、成功なら `{ ok, url, via:"gh" }`。失敗/未インストールなら `resolveGithubUrl` から compare URL を作って `{ ok, url, via:"compare" }`。GitHub でなければ `{ ok:false, reason:"no-github" }`。
  - 純粋 helper `compareUrl(githubUrl, base, branch)` を切り出してテスト。
  - `git` ランナーは `worktrees.ts` 再利用、`gh`/`git push` は stderr も取る専用 runner。
- `server/worktree-routes.ts`: `POST /api/worktrees/push`、`POST /api/worktrees/pr`（origin ガード）。reason → status: 失敗系(failed/push-failed)=500、前提系(not-worktree/no-branch/no-remote/no-github)=409。
- spec: bare remote を origin にして push 成功、no-remote、not-worktree、compareUrl の URL 形。

## フロント
- `TerminalCell.vue` diff パネルにフッタ: **[⬆ Push] [⧉ Open PR]** ＋ 結果メッセージ行。
- `ahead === 0`（コミット無し）なら両ボタン disable（「ターミナルで commit してね」）。
- Open PR 成功で `window.open(url)`。失敗は reason をメッセージ表示。実行中は disable。
- spec: ボタン表示/disable、push 成功メッセージ、PR 成功で window.open、no-remote 等のエラー表示。

## 非対象
マージ / 破棄、node_modules 戦略、自動 cleanup（#108 の別タスク）。
