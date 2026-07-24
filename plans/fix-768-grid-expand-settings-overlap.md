# fix: grid expand 時に設定ボタンが view-toggle に覆われる（#768）

## User Prompt

> 右上のアイコン群、grid viewにすると設定ボタンが消えるからなおして
> grid + expand時にでないのだ。

## 症状

grid view で**セルを expand した時だけ**、global header の設定ボタン（⚙）が消え、白い ☰ ボックスに置き換わって見える。

## 原因

`TerminalGrid.vue` の zoom 時に出る view-toggle ボタン（`☰`/`▤`、list⇔strip 切替）は
`position: absolute; right: 12px; top: 8px; z-index: 10`。しかし親 `.stage` に `position` が無く（static）、
祖先チェーン（`.stage` → GridView の flex 列 → App）にも positioned 要素が無いため、
絶対配置の基準が **viewport（初期包含ブロック）** になる。結果、ボタンはウィンドウ右上＝ツールバーの
設定ボタン位置に来て、z-10 で ⚙ を覆う。`overflow: hidden` は包含ブロックを作らない（position/transform 等が必要）。

## 修正

`src/components/TerminalGrid.vue` の `.stage` に `position: relative` を追加（+ 理由コメント）。
view-toggle は `.stage`（ツールバーの下）の右上に収まり、⚙ が復活。off-screen `.grid`（`left:-99999px`）等
他の絶対配置子は基準が viewport→.stage に変わるが位置は不変（-99999px は依然オフスクリーン）。

## 検証

- 最小 HTML でツールバー＋非 positioned `.stage`＋絶対 top-right ボタンを再現。
  position 無し → ☰ が⚙を覆う（ユーザー報告スクショと一致）。`position: relative` → ⚙復活・☰は stage 内へ。
- 通常（非expand）グリッドは回帰なし（実アプリでスクショ確認）。
- CSS レイアウト修正のため jsdom 単体テスト不可（機構は最小再現＋コメントで固定）。

typecheck(app) / build / 関連 grid テスト（29件）パス。
