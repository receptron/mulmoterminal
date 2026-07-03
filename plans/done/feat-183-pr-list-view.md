# feat #183: 複数リポ横断の GitHub PR 一覧ビュー

## User Prompt
> 183欲しい

（Issue #183）別 view（全画面）で、設定で指定した複数リポの PR を串刺し表示。

## 設計判断（デフォルト確定）
- リポ指定: config.json の `prRepos: ["owner/repo", …]` 明示リスト（Settings で編集）。
- 認証: サーバの `gh` CLI（既ログイン。`worktree-pr.ts` の `run("gh", …)` を踏襲）。
- 表示: 全 author の open PR（draft 含む・印付き）、リポ別グルーピング、CI/レビュー状態。
- 更新: 手動リロード＋ビューを開いた時。ポーリングなし。
- クリック: GitHub を新規タブで開く。

## 変更
### サーバ
- `app-config.ts`: `AppConfig.prRepos: string[]` 追加、`sanitizeRepos()`（`owner/repo` 形のみ）、load/save 反映。
- `config-routes.ts`: GET に `prRepos`、POST で受理（配列・sanitize）、`getPrRepos()` を export。
- `prs.ts`(新): `listPrsAcrossRepos(repos)` — 各リポを `gh pr list --repo <r> --json number,title,author,updatedAt,isDraft,url,reviewDecision,statusCheckRollup --state open` で取得→正規化。純関数 `rollupCiState(statusCheckRollup)`（passing/failing/pending/none）をテスト可能に。リポ単位のエラーは握って `{repo, error}` として返す（全体は落とさない）。
- `index.ts`: `GET /api/prs` を mount（`listPrsAcrossRepos(getPrRepos())`）。

### クライアント
- `router/index.ts`: `{ path: "/prs", name: "prs" }`。
- `usePrsView.ts`(新): `useWikiBrowse` を踏襲（`prsGotoIndex`/`prsClose`/`usePrsView`）。
- `PrsOverlay.vue`(新): 全画面オーバーレイ。`/api/prs` を取得しリポ別に表示（#・title・author・draft・updated・CI・review）、行クリックで GitHub、リロードボタン、loading/error/empty（未設定は Settings 誘導）。
- `App.vue`: `<PrsOverlay />` を mount。
- `AppToolbar.vue`: PRs ランチャーボタン（Material Symbol `call_merge`）。route `prs` で active、クリックで `prsGotoIndex()`。
- `useAppConfig.ts`: `prRepos` を load/save で公開（`savePrRepos`）。
- `SettingsModal.vue`: `prRepos` の最小編集（owner/repo 追加・削除）。

## テスト
- `app-config.spec.ts`: prRepos の round-trip / sanitize。
- `prs.spec.ts`(新): `rollupCiState` と正規化。
- `PrsOverlay.spec.ts`(新): fetch モックで描画・グルーピング・空表示。

## ゲート
typecheck(client/server) / format / lint / build / test
