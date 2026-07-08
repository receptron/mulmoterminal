# fix #269 — expand/restore + close を1行目に

#260 で2行目に寄せたアクションのうち、**expand/restore と close だけ1行目**に戻す。

## 実装
- `TerminalCell.vue` cell-header（1行目）末尾に `.cell-actions`（expand/restore + close、`@click.stop`）。
- 2行目スロット（#header-actions）から expand/close を削除（GitHub / 🕘 / 並べ替えは据え置き）。
- フィルムストリップ専用の zoom ボタンは一般 expand に統合（1行目に常設）。
