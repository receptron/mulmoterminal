# fix #274: 通常グリッドではヘッダークリックで拡大しない

## 現象
通常グリッドでセルのヘッダー背景をクリックすると拡大される。通常時は ⤢
ボタンのみで拡大したい（ヘッダークリック拡大は誤操作の元）。

## 原因
`src/components/cellHeaderZoom.ts`:

```ts
export function shouldZoomOnHeaderClick(target, expanded): boolean {
  if (expanded) return false;
  return !(target instanceof Element && target.closest("button"));
}
```

`!expanded` なら（=通常グリッドでも）ヘッダー背景クリックで zoom していた。

## 修正
判定を「filmstrip（他セルが拡大中の縮小サムネイル = `zoomed && !expanded`）の
ときだけ zoom」に限定:

- `cellHeaderZoom.ts`: 第2引数を `expanded` → `filmstrip` に変更、`if (!filmstrip) return false`。
- `TerminalCell.vue`:
  - `onHeaderClick` は `filmstrip.value` を渡す。
  - `.cell-header` の `is-zoomable` を `!expanded` → `filmstrip`（通常グリッドで
    ポインタカーソル/ホバーを出さない）。

### 挙動
- 通常グリッド: ヘッダークリックで拡大しない（⤢ ボタンのみ）
- filmstrip サムネイル: ヘッダークリックで「そのターミナルに切り替え」= 維持
- 拡大中セル: ヘッダークリック無視（復元は ⤡）= 維持

## テスト
- `cellHeaderZoom.spec.ts`: `filmstrip` セマンティクスに更新（通常グリッド=false
  では常に false、サムネイル=true でボタン判定）。
- `TerminalCell.spec.ts`: 通常グリッドのヘッダー背景クリックで `toggle-expand` を
  emit しない／⤢ ボタンは emit する／filmstrip はヘッダークリックで emit する。
