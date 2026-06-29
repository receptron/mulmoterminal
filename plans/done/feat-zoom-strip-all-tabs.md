# feat: 拡大(zoom)時に全タブのターミナルを下のストリップへライブ表示

Issue: #95

## 背景 / 現状

- グリッドの cells は **1本のフラット配列**（`gridTabs.ts`）。タブ＝9個ずつの「ページ」slice。
- 拡大(zoom)すると `TerminalGrid` は filmstrip 表示に切替（上=拡大セル、下=横スクロールのストリップ）。
- `GridView` は `TerminalGrid` に **現ページの slice (`pageCells`) だけ**を渡すため、ストリップにも **現タブの9セルしか並ばない**。
- 設計上、**アクティブページのみマウント**、他ページはサーバ側のバックグラウンドPTYとして生存し再表示時に再接続する（省リソース）。

## ゴール

拡大中だけ、下のストリップに **全タブ・全ターミナルをライブ表示**（横スクロール）。非拡大時は従来どおり現ページのみ。

## 設計

「描画するセル集合」を切り替えるだけで実現できる（フラット配列ゆえ単純なソース差し替え）。

### `gridTabs.ts`（純粋関数を追加・テスト対象）

```ts
// 拡大中のセルの uid（cells に存在する場合）。なければ null。
export function zoomedUid(state: GridState): number | null

// 描画対象セル: 拡大中は全セル（全タブをストリップに）、非拡大時は現ページの slice。
export function visibleCells(state: GridState): Cell[]
```

### `GridView.vue`

- `pageExpanded` を `zoomedUid(state)` に置換。
- `TerminalGrid` へ `:cells="visibleCells(state)"`、`:expanded-uid="zoomedUid(state)"`。
- 拡大中はタブ意味が無いので、タブバーを隠す（`v-if="pages > 1 && zoomedUid === null"`）。

### `TerminalGrid.vue`

- ロジック変更なし（渡されたセルを描画。拡大セルは zoom-main へ teleport、残りはストリップ）。
- `gridStyle` は `layoutForCount` が 9 超でも `Math.min(MAX_CELLS,…)` で安全。拡大中は `.stage.zoomed .grid` のCSSで grid-template が上書きされ未使用。
- 先頭コメントを「拡大中は全タブのセルを受け取る」旨に更新。

## トレードオフ

- 拡大中は全ターミナル（最大81）の xterm + WebSocket が同時マウントされる。数が多いと重い。要望により上限は設けない（PR に明記）。
- 拡大解除で `visibleCells` は現ページ slice に戻り、オフページのセルはアンマウント（既存の再接続セマンティクスを再利用）。

## テスト

- `gridTabs.spec.ts` に `zoomedUid` / `visibleCells` のユニットテストを追加
  - 非拡大: 現ページ slice を返す
  - 拡大: 全セルを返す / `expanded` が cells に無い場合は null & 現ページ slice
  - ページ境界（2ページ目を拡大）

## 確認ゲート

`yarn format` / `lint` / `typecheck` / `build` / `test`。UI実機（拡大→全タブが下に並ぶ／横スクロール／クリックで切替）は手元で目視確認。
