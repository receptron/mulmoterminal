# feat #244 — モデル/コンテキスト・バッジ

親: #241（Terminal + AI 状態管理・可視化・支援レイヤー）／子 C。

## ゴール

セルヘッダのバッジに「どのモデルが動いているか」と「context をどれだけ使っているか」を表示する。
既存のトークンバッジ `⇡in ⇣out` の隣に `Opus · ctx 35%` のように出す。

## 設計判断

- **モデル名**: transcript の最新 assistant ターンの `message.model`（例 `claude-opus-4-...`）を読む。
  短ラベルへマップ: Opus / Sonnet / Haiku（部分一致・大小無視）／ それ以外は id の末尾セグメント（codex 等）。
- **context %**: 現在の context サイズ ÷ モデルの context window。
  現在の context = **最新** assistant ターンの `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`。
  累積（`sessionUsageFromJsonl`）はターン間で二重計上になるため使わない。
- **context window テーブル**: 同梱ハードコード表（Claude Opus/Sonnet/Haiku ≈ 200,000）。
  未知モデル → ラベルのみ表示し % は非表示（推測しない）。
- **agent 種別**（claude/codex）はクライアント側で既知（cell の `agent` ref）。tooltip に使用。

## 変更ファイル（スコープ限定）

1. `server/transcript.ts` — 純関数 `latestTurnContextFromJsonl(raw): { model, contextTokens }` を追加。
2. `server/transcript.spec.ts` — 上記の単体テスト（最新ターン抽出・モデル抽出・複数ターン・空/壊れた行）。
3. `server/index.ts` — `readSessionSummary` と `/api/session/:id` に `context`（model + contextTokens）を追加（加算的）。
4. `src/components/ModelContextBadge.vue`（新規）— ラベル + ctx% の描画。window テーブルとラベルマップを保持。
5. `src/components/ModelContextBadge.spec.ts`（新規）— Opus/Sonnet/Haiku・未知モデルで % 非表示・codex id 末尾。
6. `src/components/TerminalCell.vue` — `context` を fetch して `ModelContextBadge` を描画。

## 検証

- `yarn format`
- `node_modules/.bin/eslint server src`（0 errors）
- `yarn typecheck` / `yarn typecheck:server` / `yarn build`
- `yarn test`（新規 spec）
