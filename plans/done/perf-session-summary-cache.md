# perf: /api/session/:id の transcript 全読み＆多重パースを解消（Phase 1）（#368）

Issue: #368 / Branch: `perf/session-summary-cache`

## User Prompt

- ターミナルがすごく重い。ひょっとしてログが長くなると全部読んでて重くなる？
- （調査で原因を特定 → 合意）issue にして Phase 1 を実装。

## 原因（調査結果）

`server/index.ts` の `readSessionSummary`（`GET /api/session/:id` が使用）が呼ばれるたびに:

1. transcript `.jsonl` を**丸ごと** `fs.readFile`
2. その文字列を **6ヘルパ**が各自 `parseJsonl` → 実質フル解析を最大6回
3. **キャッシュなし**（mtime 不変でも毎回）

同期CPU処理なので Node のイベントループを止め、PTY を流す WebSocket ごと固まる＝全ターミナルがカクつく。呼び出し頻度が高い（ターン完了ごとに各グリッドセル、ウィンドウフォーカスごと、セッション切替・マウント時）。実データで最大 456 MB / 66,470 行の transcript が存在。

## 対応（Phase 1）

- **1リクエスト1回パース**: `server/transcript.ts` に `*FromParsed(records)` 変種を追加し、`readSessionSummary` は `parseJsonl` を1回だけ実行して6値を導出。既存 `*FromJsonl(raw)` は `*FromParsed(parseJsonl(raw))` の薄いラッパとして維持（既存呼び出し・テストは無改変で通る）。
- **mtime+size キャッシュ**: 汎用の `server/file-cache.ts`（`createFileCache`、rough-LRU、上限500）を新設。`readSessionSummary` は先に `fs.stat` して `(mtimeMs,size)` が前回と同じなら `readFile`/パースを丸ごとスキップ。append-only な `.jsonl` に対し `(mtime,size)` は十分な鮮度スタンプ。

## 計測（マイクロベンチ、42.8 MB / 8万行）

- OLD（6回パース）: ~483 ms（イベントループ停止）
- NEW（1回パース）: ~111 ms（約4.4倍）
- キャッシュヒット（不変ファイル）: ~0 ms（read+parse を丸ごと省略）

実際の 456 MB 級では旧経路は数秒級のフリーズ。フォーカス/他セルの大半は不変ファイルへのアクセスなのでキャッシュでほぼ消える。

## 変更ファイル

- `server/file-cache.ts`（新）/ `server/file-cache.spec.ts`（新）
- `server/transcript.ts` — `*FromParsed` 変種＋`*FromJsonl` ラッパ化
- `server/transcript.spec.ts` — parse-once 等価テスト
- `server/index.ts` — `readSessionSummary` を stat→cache→(miss時)read+parse-once に

## Phase 2（別issue想定・本件対象外）

- 末尾読み（model / 現ターン context / 最終応答・プロンプトはファイル末尾だけで足りる）
- 累計 usage の増分計算（前回サイズ以降の追記分だけ加算）
- `sessionTimeline`（TimelineOverlay 用）も同種の全読みだがオンデマンド。必要なら同じ mtime キャッシュを適用。
