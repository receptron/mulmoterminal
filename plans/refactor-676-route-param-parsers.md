# refactor: shared route-param parsers (#676 ついで)

対象 issue: https://github.com/receptron/mulmoterminal/issues/676（「ついで」節）

## 問題

2 つの query-param 判断がルートにコピペで散在していた:

- `/^\d+$/` の index パース: `ws-routes.ts` の `?index=`（run）と `?launcher=`（launch）で完全重複。
- `agent === "codex" ? "codex" : "claude"` の正規化: `ws-routes.ts` / `session-routes.ts` / `dir-routes.ts` の 3 箇所に重複（大文字 `CODEX` は黙って claude に倒れる）。

判断が複数箇所に散ると片方だけ変わってドリフトする。

## 変更

- 新規 `server/routes/routeParams.ts`:
  - `parseIndexParam(raw: string | null): number` — 非負整数のみ、それ以外は NaN（下流 `resolveScript`/`canStartLauncher` が NaN を拒否）。
  - `normalizeAgent(raw: unknown): "codex" | "claude"` — 厳密に `"codex"` のときだけ codex、それ以外（`"CODEX"`・空・null・配列など）は claude。
- 5 箇所の呼び出しを置換（ws-routes ×3、session-routes ×1、dir-routes ×1）。挙動不変。

## テスト

`test/server/routes/routeParams.spec.ts`: parseIndexParam の正常/NaN 群（空・負・小数・指数・前後空白）、normalizeAgent の codex 一致・各種フォールバック・大小文字非対称の pin。両パーサを壊すと 3 件赤・戻すと緑を変異テストで確認済み。
