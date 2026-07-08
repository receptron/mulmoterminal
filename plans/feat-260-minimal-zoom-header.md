# feat #260 — グリッドセルの2行ヘッダを整理（情報 / アイコンを分離）

グリッドセルのヘッダが2行（1行目: dir/git/GitHub/🕘/並べ替え/⤢/✕、2行目: Terminal/connected/📎/📁）で
アイコンと情報が混在。整理して **1行目=情報 / 2行目=操作アイコン** に分ける。通常グリッドがメイン、
拡大時も同じレイアウト（シンプルに統一）。

## 実装

- `Terminal.vue` のヘッダ行（2行目）に `<slot name="header-actions" />` を追加。
- `TerminalCell.vue`:
  - **1行目（cell-header）= 情報のみ**: 状態ドット・dir（クリックで開く）・name バッジ・GitBranchChip・
    diff バッジ・ModelContextBadge・token usage・prompt（何をしているか）。
  - **アクションアイコンを2行目へ**: GitHub メニュー・🕘 タイムライン・並べ替え ◀▶・拡大/復元 ⤢⤡・
    閉じる ✕ を `<template #header-actions>` で TerminalView（＝2行目）に注入。
  - 旧「拡大時に最小化 / 2行目を隠す」ロジックは撤回（`:hide-header` を渡さない）。

Vue のスロットは親スコープで解決されるため、GitHub メニューの `ghWrap` ref / click-outside、各ボタンの
emit ハンドラ、TerminalCell のスコープ付き CSS（cell-btn / cell-gh-*）はそのまま機能する。

## 非スコープ
- 単一ビュー（App.vue の Terminal）— 本件はグリッドセル。単一ビューでは slot は空。
- 2行目内のアイコンの並び順の微調整（現状: connected/📎/📁 の後に GitHub/🕘/並べ替え/⤢/✕）。
