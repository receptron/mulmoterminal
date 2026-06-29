# Plan: グリッド端末の最下部スクロール/fit 修正

Issue: #79
作成日: 2026-06-21

## 症状
1. グリッドviewで狭いレイアウト（3x3 等）にすると、端末の**最下部の入力行が見えず、スクロールもできない**。改行すると xterm がスクロールして時々見える。
2. **拡大（フルスクリーン）→ grid に戻したとき**、スクロール位置が入力部分になっていない。

## 根本原因
1. `Terminal.vue` の `.terminal-container`（xterm ホスト, `flex:1`）に **`min-height:0` が無い**。flexbox の自動最小サイズで flex アイテムの `min-height` 既定 `auto`＝コンテンツ（xterm 全行）の min-content 高さが下限になり、低いセルで縮めず親 `.cell{overflow:hidden}` にクリップされる。`FitAddon.fit()` も縮まない `clientHeight` を読み行数を減らさず膠着。
2. `fit()` のリフロー後、ビューポートが最下部に残らないことがある（拡大⇄復帰で顕著）。

## 修正（CSS + 最小JS）
- `.terminal-container`（および `.terminal-wrapper`）に `min-height: 0` を追加。容器が縮めるようになり、`fit()` がセル高さに合わせて行数を再計算。
- ResizeObserver の `fit()` 後に `term.scrollToBottom()` を呼び、リサイズ/拡大復帰後も入力行を表示（引き継ぎ不可なら最下部、というユーザ方針）。

## 検証
- lint 0 errors / typecheck / build。
- 実機（localhost:5173）: 3x3 で入力行が見える / 拡大→復帰で最下部表示 / レイアウト切替で追従。

## 備考
- 回帰修正 #78（`TerminalGrid.vue` の solo zoom revert）とはファイルが別の独立変更。
