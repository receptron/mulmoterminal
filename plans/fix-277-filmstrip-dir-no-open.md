# fix #277: filmstrip サムネイルの dir は開かず拡大に切替

## 現象
セル拡大時、下部の filmstrip サムネイルの dir 名をクリックすると dir が開く
(`/api/open-dir`)。filmstrip のヘッダーは「そのターミナルに切替（拡大）」が
主動作であるべきで、dir を開くのは不要。

## 原因
`TerminalCell.vue` の `cell-dir` は `<button @click="openDir">`。
`shouldZoomOnHeaderClick` はボタン上クリックを zoom 対象外にするため、filmstrip
でも dir クリックは zoom せず openDir が走る。
（`CommandCell`/`LauncherCell` の dir は既に `<span>` なので対象外。）

## 修正
`TerminalCell.vue`: dir を filmstrip 有無で出し分け。
- 通常グリッド / 拡大中の本体（`!filmstrip`）: `<button @click="openDir">`（従来）。
- filmstrip: `<span class="cell-dir">`（inert text）。非ボタンなので header の
  zoom ジェスチャー（`shouldZoomOnHeaderClick` が closest("button")=null → zoom）
  に吸収され、クリックで拡大に切り替わる。

## テスト (`TerminalCell.spec.ts`)
- filmstrip テスト: `button.cell-dir` は無く `span.cell-dir` がある。
- 追加: filmstrip の dir クリックで `toggle-expand` を emit し、`/api/open-dir`
  は呼ばれない。
- 既存: 通常グリッドの dir クリックは従来どおり `/api/open-dir` を呼ぶ（不変）。
