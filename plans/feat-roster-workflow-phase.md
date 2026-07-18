# feat #428 — cockpit roster にワークフロー・フェーズを表示

Issue: #428。grid の zoom + list mode の cockpit roster（`TerminalGrid.vue`）に、
今出ているエージェント活動状態（idle / running …）の並びに、上位の**ワークフロー・
フェーズ**（PR待ち / PRのloop / mergeまち 等）を出す。

## 分割方針

1. **バックエンド: PR フェーズ解決器**（この plan の対象・split 1）
2. フロントエンド: roster に phase バッジを描画（split 2）
3. エージェント側の細分化: plan中 vs 実装中（split 3）

## Split 1 の設計（バックエンド）

- **`server/git/prPhase.ts`**:
  - `PrPhase` enum: `none` / `draft` / `ci-failing` / `changes-requested` / `ci-running` / `ready` / `merged` / `closed`。
  - `parsePrView(stdout)`: `gh pr list --json ...` の先頭要素を `ParsedPr`（state / isDraft / mergeable / reviewDecision / ci）へ。CI は既存 `rollupCiState`（prs.ts）を再利用。
  - `derivePrPhase(pr)`: **純粋**な導出。OPEN の優先順は draft > ci-failing > changes-requested > ci-running > ready。MERGED→merged / CLOSED→closed / PR無し→none。
  - `phaseForRepoBranch(repo, branch, deps)`: `gh pr list --head <branch> --repo <repo> --state all --json state,isDraft,mergeable,reviewDecision,statusCheckRollup --limit 1` → parse → derive。**キャッシュ付き**（gh はコスト高、`prUrlForBranch` と同じ 30s TTL）。deps 注入でテスト可能。
- **cwd→repo/branch のグルーはルート側**（prPhase.ts に config 層を import させない）。ルートは既存の `gitStatus`（branch）+ `resolveGithubUrl` + `repoFromWebUrl`（owner/repo）を使う（`/api/header` と同じパターン）。
- **ルート `GET /api/pr-phase?cwd=`** → `{ phase, prUrl }`。read-only（`/api/git-status` と同じ作法）。
- **テスト**: `derivePrPhase` の全分岐マトリクス、`parsePrView`（正常/空/壊れJSON）、`phaseForRepoBranch`（gh stub でキャッシュ・分岐）。

## 設計上の注意

- gh ポーリングは高コスト → キャッシュ + roster 可視時のみ + 数十秒間隔（split 2 で徹底）。
- 決定的な PR 系を先に（split 1/2）、ヒューリスティックな plan/implement は後（split 3）。
