# Plan: グリッドレイアウトの自動化（実行中数ベース）＋ツールバー追加

Issue: #81
作成日: 2026-06-21

## ゴール
固定レイアウトの手動選択をやめ、**実行中ターミナル数からレイアウトを自動導出**。追加は**ツールバーの「＋」で1つずつ**。

## レイアウト導出
`gridLayout.ts`:
- `LAYOUTS = ["1","2","2x2","3x2","4x2","3x3"]`（`1`=1×1, `2`=1×2 横並びを追加）。
- `layoutForCount(n)` = n（1..9 にクランプ）が収まる最小レイアウト: 1→`1`, 2→`2`, ≤4→`2x2`, ≤6→`3x2`, ≤8→`4x2`, else→`3x3`。

## TerminalGrid.vue
- `layout` prop を削除。
- `runningCount` = session 付き slot 数。
- `adding` ref。`cellCount = min(9, runningCount + ((adding || runningCount===0) ? 1 : 0))`。
- `layout = layoutForCount(cellCount)` → `gridStyle = trackStyle(layout, null)`。
- `addCell()`（expose）: `adding` をトグル（true は running<9 のときのみ）。
- `setSession`: 非 null id で `adding=false`（起動セルが実行中に昇格）。
- `add-state` emit `{ canAdd: running<9, adding }`（ツールバー側のボタン状態）。
- 据え置き: compaction / zoom(teleport) / persistence / UUID 検証。

## GridView.vue
- 手動レイアウトピッカー・`LAYOUTS`・`grid_layout` localStorage を削除。
- ツールバーに「＋」ボタン: `gridRef.addCell()`。`adding` 中はアクティブ表示、`!canAdd && !adding` で disabled。
- `<TerminalGrid ref=... @add-state=...>`（`layout` prop は渡さない）。

## テスト
- `gridLayout.spec.ts`: LAYOUTS 更新、`1`/`2` の dims、`layoutForCount` の境界（1,2,3,4,5,6,7,8,9,0,超過）。
- `TerminalGrid.spec.ts`: 旧 layout-prop 前提を、実行中数からの自動導出に書き換え（0→1セル/復元で実行中のみ表示/`addCell` で+1/launch で adding 解除/close で縮小/compaction 据え置き）。

## 据え置き・スコープ外
- 複数タブ（面）や 9 超のセッションは対象外（従来どおり 1 グリッド・最大 9）。
