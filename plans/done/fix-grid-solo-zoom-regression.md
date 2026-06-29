# Plan: グリッド拡大view 回帰の修正（solo full-height zoom を revert）

Issue: #77
作成日: 2026-06-21

## 症状
グリッドの拡大view（filmstrip zoom, PR #71）が不調。特に**端末1つだけ拡大すると header が消える/拡大が出ない**。

## 原因（git 二分法）
`0830d3b`（PR#71ブランチ=good）↔ `main`（bad）の差分で**グリッドを触るのは `744a777` のみ**:
> fix(grid): full-height zoom when solo + compaction regression tests (PR #71 review)

追加された solo 対応（`soloZoom` computed / `.stage` の `solo` クラス / `.stage.zoomed.solo .grid { display: none; }`）が原因。`.grid` は `<Teleport>` のソースコンテナ（拡大セルのみ `zoom-main` へ teleport、残りは `.grid` に留まる）。そこを `display:none` で隠す処理が単一端末・拡大ケースの表示を壊す。ユーザが両ブランチを実機確認し good/bad を確定。

## 対応（低リスク revert）
- `TerminalGrid.vue` の solo 変更を除去 → `0830d3b` と完全一致（既知good）。
- `TerminalGrid.spec.ts` の solo テスト2件を削除、**compaction 回帰テストは残置**。
- 「solo時フルheight zoom」機能は一旦失う。再実装は `display:none` を使わず strip を `flex:0/height:0/overflow:hidden` で潰す等で別途。

## 検証
- `TerminalGrid.vue` が `feat/grid-filmstrip-zoom` と diff 空。
- lint 0 errors / typecheck / build / grid 単体テスト 14 pass。
- 実機（localhost:5173）で単一/複数端末の拡大・解除・header を確認。

## 別件（このPR対象外）
- **スクロール最下部が表示されない問題**は本 revert では直らず、独立の既存バグとして別途調査。
