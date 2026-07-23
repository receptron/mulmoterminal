# feat #707 — cockpit roster の各行に ⋮ メニューで並べ替え

対象 issue: https://github.com/receptron/mulmoterminal/issues/707

## 決定事項（モックで確認済み）

- ⋮ は grid ズーム時の cockpit roster（`data-testid="cockpit"`）各行ヘッダーの**右端**。
- メニューは **上へ移動 / 下へ移動**。端の行は該当方向を無効化。
- **manual ソートのときだけ** ⋮ を出す（`reorderable` prop）。
- 実処理は既存の `moveCell(uid, ±1)`（縦なので −1=上 / +1=下）。

## 実装

### `src/components/gridTabs.ts`
- 隣接ガードを pure 関数 `canMoveCell(cells, uid, dir): boolean` に切り出す（端 / 末尾 launch セル手前で false）。`moveCell` を `if (!canMoveCell(...)) return state` で書き換え（挙動不変）。端の無効化判定に使う。

### `src/components/CockpitRowMenu.vue`（新規）
- ⋮ ボタン + ドロップダウン（上へ移動 / 下へ移動）。`useDropdownMenu` を流用（外側クリック / Esc で閉じる）。props `canUp` / `canDown` で各項目を無効化。`move(dir)` を emit。root は `@click.stop` で行のクリック（拡大切替）に伝播させない。

### `src/components/TerminalGrid.vue`
- roster 行を `<button>` → `<div role="button" tabindex="0">` に（ボタン入れ子回避）。`@click` は据え置き、`@keydown.enter/space.self` で activate（`.self` で ⋮ ボタンのキー操作と衝突しない）。
- ヘッダーの dir の後ろに `<CockpitRowMenu v-if="reorderable" :can-up="canMoveCell(cells, row.uid, -1)" :can-down="canMoveCell(cells, row.uid, 1)" @move="(dir) => emit('move', row.uid, dir)" />` を追加。`@move` は既存の `move` emit（GridView の `onMove` → `moveCell`）に流す。

## テスト

- `test/src/components/gridTabs.spec.ts`: `canMoveCell`（中間 true、先頭 up false、末尾 down false、末尾 launch セル手前 false、不正 uid false）。既存 `moveCell` テストは不変で緑。
- `test/src/components/CockpitRowMenu.spec.ts`（新規）: 初期は閉、⋮ で開閉、上/下クリックで `move(∓1)` emit + 閉、無効項目は emit しない。
- `test/src/components/TerminalGrid.spec.ts`: `mountCockpit` に `reorderable` 引数を足し、reorderable=true で ⋮ が出て up/down が `move(uid, dir)` を emit、false で ⋮ が出ないことを確認。

各テストは変異テストで「壊すと落ちる」ことを確認してからマージ。
