# fix: expand 時に view-toggle(☰) がセルの ✕ 閉じるボタンを覆って閉じられない

## User Prompt

> あれれ、expand時のボタンを移動したせいで、今度は閉じられなくない？

（#769 で `.stage { position: relative }` を入れた直後の回帰報告）

## 背景 / 症状

#769 で「grid+expand 時に設定歯車が view-toggle に覆われる」問題を、`.stage` に
`position: relative` を与えて解決した。しかしこれで view-toggle（`☰`/`▤`、`absolute right-3 top-2 z-10`）
の絶対配置基準が viewport → `.stage` に変わり、今度は **stage 右上 = zoom セル（`.zoom-main`）右上に固定された
`.cell-actions`（⤢/⤡ 展開＋✕ 閉じる、各 28×26px）の真上**に乗ってしまい、✕ で閉じられなくなった。
歯車の overlap を ✕ の overlap に付け替えてしまった形。

## 原因

view-toggle は右上固定。zoom セルの閉じる/展開ボタンも（セルは stage 右上を占めるため）stage 右上固定。
両者が同じ右上コーナーで重なる。`.stage` を static に戻すと #768（歯車 overlap）が再発するので戻せない。

## 修正

view-toggle を stage の **左上**（`right-3` → `left-3`）へ移動。
- 歯車（ヘッダ右上）とも ✕/⤡（セル右上）とも重ならない。
- トグルは元々「左サイドパネル（コックピット/ストリップ）の表示切替」なので左上配置は意味的にも自然。
- `.stage { position: relative }` は維持（無いと左上が viewport 基準になりヘッダのタイトル/ナビに乗る）。

副作用: 左上はコックピット先頭行ヘッダ（listMode）／zoom セルのステータスドット（strip）の左端に
26px 重なるが、いずれも**操作ボタンではなく情報表示**なので実害なし。

## 検証

- 実レイアウト（toolbar＋歯車／stage relative／cockpit＋zoom-main／セル `.cell-actions` を実寸で再現）で
  Before/After を描画。Before は ▤ が ✕ を覆う（報告と一致）、After は ✕（赤）と ⤡ が露出・歯車もクリア。
- CSS レイアウト修正のため jsdom 単体テスト不可（機構は再現＋コメントで固定）。

typecheck(app) / build / grid テスト（TerminalGrid + GridView, 29件）パス。
