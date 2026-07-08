# feat #267 — サマリーを「Copy as prompt」

案A → フィードバックで **Copy 方式**に転換。Run セルの ✦ Summary パネルに「Copy as prompt」を追加し、
command + cwd + 要約 + 続きの行を**クリップボードにコピー**。ユーザーが好きな Claude セッション
（グリッドのセル / 単一ビュー）に貼って続ける。ビューのジャンプなし・最も柔軟。

## 実装
- `CommandCell.vue`: `copyPrompt()` が `navigator.clipboard.writeText` で
  `Command: <label>` / `Directory: <cwd>` / `Summary of its output:` / `<summary>` / `Follow-up:`
  を改行付きでコピー（クリップボードは改行を保持）。ボタンは押下後 1.5s「✓ Copied」表示。
- セッション起動・cwd 配線（spawnBackgroundChat の cwd / startCollectionChat の cwd）は撤回。

## 非スコープ（follow-up 候補）
- グリッドセルで直接起動（②案）
- 生出力全文の同梱 / Codex
