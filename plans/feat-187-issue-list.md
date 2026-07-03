# feat-187: /prs ビューに複数リポ横断の open issue 一覧を追加

Issue: #187 / Refs #183

## ゴール
`/prs` ビューに、`prRepos` と同じリポ群の **open issue 一覧**を PR の下に追加する。

## 決定事項
- 範囲: 各リポの open issue を最新20件まで。超過分は GitHub の issues ページへのリンクで誘導。
- リポ: `prRepos` を再利用（別設定なし）。
- レイアウト: `/prs` ビュー内を2セクション化。上=全リポの PR（既存）、下=全リポの issue（新規）。
- 取得: `gh issue list --repo R --state open --limit 21`（21件取得→20件表示で truncated 誤検出回避）。
- クリック: 行クリックで GitHub の issue を新規タブで開く。

## 変更ファイル
- `server/gh.ts`（新）: `runGh(args)` — `gh` spawn ヘルパを prs.ts から抽出して共有（DRY）。
- `server/prs.ts`: ローカル `run` を削除し `runGh` を使用。
- `server/issues.ts`（新）: `IssueItem` / `RepoIssues` / `ISSUE_LIMIT=20` / `normalizeIssue` / `listIssuesAcrossRepos`。
- `server/index.ts`: `GET /api/issues`（`getPrRepos()` 再利用）。
- `src/components/PrsOverlay.vue`: `/api/prs` と `/api/issues` を並列 fetch、issue セクション追加、タイトルを "PRs & Issues" に。
- テスト: `server/issues.spec.ts`（新, normalizeIssue）、`src/components/PrsOverlay.spec.ts`（issue 描画・truncation リンクを追加）。

## ゲート
typecheck(client/server) / format / lint / build / test を通す。
