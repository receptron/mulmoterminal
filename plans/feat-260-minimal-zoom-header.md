# feat #260 — 拡大中のセルはヘッダを最小化

グリッドセルを拡大（zoom）したとき、ヘッダを「dir + 何をしているか + 復元トグル」だけにする。

## 実装

`TerminalCell.vue` の `cell-header` で `expanded` のとき:
- dir を `<button @click=openDir>` → `<span class="cell-dir-static">`（クリックで開かない）
- GitBranchChip / diff バッジ / GitHub メニューを `<template v-if="!expanded">` で包む
- ModelContextBadge / usage / 🕘 / 並べ替え / 閉じる ✕ に `&& !expanded`
- 残すのは 状態ドット・dir・name バッジ・prompt・復元トグル ⤡

埋め込み `Terminal.vue` は `hideHeader` prop を追加し、`TerminalCell` が `:hide-header="expanded"` を渡す
→ Terminal/connected/📎/📁 の header 行を非表示。

非拡大時の見た目・操作は不変。

## 非スコープ
- 単一ビュー（App.vue の Terminal）— 本件はグリッドセルの拡大挙動
