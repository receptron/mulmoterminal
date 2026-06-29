# feat: git worktree によるエージェント隔離（MVP=隔離）

Issue: #106

## 背景
同一リポに複数セルを当てると作業ツリーを取り合って壊れる。ユーザーは今まで同一リポを手で複数 clone（重い・手で rm）。worktree 初体験でも自然に使えるよう、git 用語を出さず後始末を自動化する。

## MVP スコープ（このPR）
「隔離」だけ。diff→PR レビュー・node_modules戦略・自動cleanup（セルclose連動）・ブランチ表示は子issue。

### サーバ
- `server/worktrees.ts`（新規）: 純粋 helper（`slugify` / `parseWorktreeList` / `worktreesRoot` / `isManagedWorktree`）＋ git exec（`gitTopLevel` / `repoRoot` / `defaultBaseBranch` / `listWorktrees` / `createWorktree` / `removeWorktree` / `isDirty`）。
  - 作成先は管理ディレクトリ `~/.mulmoterminal/worktrees/<repo>-<hash>/<task>`（リポ直下を汚さない）。`MULMOTERMINAL_HOME` で差し替え可（テストが実ホームを汚さないため）。
  - **削除は管理ルート配下のパスのみ**許可（任意パス削除の防止）。dirty は force なしで拒否。手動削除は `worktree prune` で吸収。
- `server/worktrees.spec.ts`: 純粋 helper＋一時 git リポでの作成/一覧/削除/dirty。
- `server/worktree-routes.ts`（新規, index.ts に mount）: API。
  - `GET /api/worktrees?cwd=<dir>`（isGit/base/一覧＋各 worktree の dirty）
  - `POST /api/worktrees/create {repoDir, task}`（作成）
  - `POST /api/worktrees/remove {repoDir, path, deleteBranch, force}`（削除＋prune。dirty/管理外は 409）
  - DELETE ではなく POST：body をプロキシ越しでも確実に届けるため。mutation は origin チェック。
- `server/worktree-routes.spec.ts`: origin ガード／バリデーション／作成→一覧→削除のライフサイクル。

### フロント
- `TerminalCell.vue` ランチャ: 選択 dir が git リポなら **「新規 worktree（タスク名）」** ＋ **既存作業部屋一覧（再利用 / 🗑削除：dirty は確認）**。
- 起動: 既存 launch 経路で worktree パスを cwd に。表示はタスク名（部屋名）。

## 確認ポイント
- 用語は「作業部屋」。未コミットを黙って消さない。
- 削除は管理ルート配下限定。git 未インストールでも他機能は動く（worktree UI は出さないだけ）。
