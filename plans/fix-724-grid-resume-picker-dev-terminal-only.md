# fix #724 — grid resume ピッカーを grid 起動セッションのみに絞る

## 症状

grid 空セルの resume ピッカー（作業ディレクトリを選ぶと出る一覧）に、その dir の Claude
セッション transcript が全部並ぶ。grid 起動分だけでなく、素の `claude` や mulmoclaude など
grid 外で作られたセッションも混ざる。grid で起動した terminal だけにしたい。

## 根本原因

resume ピッカーは `/api/sessions?cwd=<dir>` を呼ぶ（`src/components/TerminalCell.vue:394`）。
`selectSessionRows`（`server/session/session-list.ts`）は dev-terminal（grid 起動）除外を
**unscoped（チャット sidebar, `includePending=true`）にだけ**適用し、cwd スコープ付き
（`includePending=false`）は「全部残す」。よって同 dir の全 Claude セッションが出る。

`includePending` は「unscoped か cwd スコープか」の判別フラグ（型定義のコメントどおり）で、
cwd スコープ付きの唯一の消費者は grid resume ピッカーのみ（`TerminalCell.vue:394`）。

## 修正

1. `server/session/session-list.ts` — dev-terminal フィルタを左右対称に:
   - unscoped: `!isDevTerminal`（grid を隠す）… 現状維持
   - cwd スコープ: `isDevTerminal`（**grid のみ残す**）… 新
   ```ts
   .filter((row) => (filter.includePending ? !filter.isDevTerminal(row.id) : filter.isDevTerminal(row.id)))
   ```
   関数 doc と `SessionRowFilter.includePending` の doc も更新。

2. `server/routes/session-routes.ts` — `devTerminalSessionsHydrated` の await を **両経路**に
   （現状は `if (includePending)` のみ）。cwd スコープも set に依存するため、boot と競合した
   resume ピッカー要求が空の set を見て grid セッションを取りこぼさないように。

## 挙動

- grid 起動セッション: resume ピッカーに出続ける（resume 可能）。
- grid 外セッション（素の `claude` / 単一ビュー / mulmoclaude 等）: resume ピッカーから消える。
- unscoped チャット sidebar: 不変（grid を隠す）。

## テスト

- `test/server/session/session-list.spec.ts`:
  - 既存「keeps grid sessions in a cwd-scoped listing」を「cwd スコープは **grid のみ** 残し外部を落とす（#724）」に更新（期待 `["grid"]`）。
  - unscoped が grid を隠す既存テストは不変であることを確認。

## 確認事項（レビュー観点）

- 外部（非 grid）セッションを grid の resume ピッカーから resume したいケースがあれば要相談。
  「grid 起動分だけで良い」が要望なので想定どおり。
- 単一ビューのチャット sidebar は不変。
