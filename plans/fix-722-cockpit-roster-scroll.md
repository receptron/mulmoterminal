# fix #722 — cockpit roster が行数過多で縦スクロールせず崩れる

## 症状

ズーム時に出る cockpit roster（サイドメニュー、`data-testid="cockpit"`）に行を入れすぎると、
縦スクロールせず枠内へ詰め込まれ、各行が潰れてレイアウトが崩れる。期待は縦スクロール。

## 根本原因

`TerminalGrid.vue`:

- roster `<aside>` は `flex flex-col ... overflow-y-auto`、高さは `.stage`（`height:100%`、list mode で
  `flex-direction:row`）に拘束されている（＝ aside 自体の高さは bounded）。
- 各行 `<div data-testid="cockpit-row">` は aside（flex-col）の flex 子要素だが `flex-shrink` が既定の `1`。

行の合計高さが aside を超えると、行が縮んで枠に収まってしまい、オーバーフローが起きない
→ `overflow-y-auto` のスクロールバーが出ない。行内は `overflow-hidden` なので潰れた中身がクリップ
されて崩れて見える。典型的な flexbox の shrink バグ。

（左の `Sidebar.vue` はセッション一覧の `<ul>` が block（flex ではない）＋ `flex-1 overflow-y-auto` で
正常。今回の対象は cockpit roster のみ。）

## 修正

roster 行に `shrink-0`（`flex-shrink: 0`）を付与するだけ。行が自然な高さを保つことで aside が
オーバーフローし、`overflow-y-auto` により縦スクロールする。行の折り畳み（line-clamp）や中身は不変。

## テスト

`TerminalGrid.spec.ts` の cockpit テストに、roster 行が `shrink-0` を持つことの回帰アサーションを追加。
jsdom は実レイアウト（scrollHeight 等）を計算しないため、崩れ自体は再現できない。縮み防止の要である
`shrink-0` クラスの付与を pin することで、将来 class から落ちる回帰を検出する。
