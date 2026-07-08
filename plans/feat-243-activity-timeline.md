# feat #243 — アクティビティ・タイムライン（AI の tool 実行履歴）

Umbrella #241 の子（B）。Claude/Codex が実行した tool（Bash/Edit/Read…）を時系列で見えるようにし、
「結局何をした？」を追えるようにする。C/D/F が再利用する共有基盤（transcript の tool 抽出）。

## スコープ（このPRのMVP）

- **サーバ（純関数）**: `server/transcript.ts` に `timelineFromJsonl(raw): TimelineEvent[]` を追加。
  `type:"assistant"` の `message.content[]` から `tool_use` ブロックを抽出し、`{ ts, tool, summary }` に整形。
  `summary` は tool の主要 input（Bash→command、Read/Edit/Write→file_path、Grep/Glob→pattern …）を1行要約（上限140字）。
- **エンドポイント**: `GET /api/transcript/timeline?session=&cwd=` → `{ events, truncated }`（直近 300 件に cap）。
- **UI**: グリッドセル（`TerminalCell.vue`）ヘッダに 🕘 ボタン → `TimelineOverlay.vue`（最新が上、時刻＋toolチップ＋要約、Escで閉じる）。

## 設計判断

- **対象 tool**: すべての `tool_use`（Bash/Read/Edit/Write/Grep/Glob/…）。read系も「何を見たか」の手がかりとして含める。
- **要約**: 主要 input 1つを1行化（140字上限）。command/file_path 等を優先。全文 Undo 等は非スコープ。
- **表示面**: まずグリッドセル（並列エージェントの「何をした」把握が主用途）。単一ビューは follow-up。
- **Undo は別 issue**（危険・スコープ大）。本PRは read-only の可視化のみ。

## ファイル

- `server/transcript.ts` — `TimelineEvent` / `summarizeToolInput` / `timelineFromJsonl`
- `server/transcript.spec.ts` — timeline 抽出のテスト追加
- `server/index.ts` — `GET /api/transcript/timeline`（`readSessionSummary` と同様に jsonl を読む）
- `src/components/TimelineOverlay.vue`（+ `.spec.ts`）
- `src/components/TerminalCell.vue` — 🕘 ボタン + オーバーレイ

## 非スコープ / フォローアップ

- 単一ビュー（`Terminal.vue`）への 🕘 追加
- Undo / タイムラインからの操作
- tool_result（出力）の要約表示（E #246 と役割分担）
