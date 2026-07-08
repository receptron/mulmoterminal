# feat #281: セル本体背景・ボーダー・ドット・ボタン色を .mulmoterminal.json で指定

#279 / #280（ヘッダー色）に続く追加。ユーザー選択の「セル本体・ボーダー」「細部
（ドット/ボタン）」を対応。#280 の `feat/cell-header-colors` に stack。

## 追加フィールド（`#rrggbb` / `sanitizeColor`）
- `cellColor` — セル本体背景（`.cell`）
- `cellBorderColor` — セル枠線
- `dotColor` — idle ステータスドット
- `buttonColor` — ヘッダーのアイコンボタン

## 実装
- `server/dir-config.ts` / `src/composables/useDirConfig.ts`: 4 フィールド追加。
- `src/components/cellHeaderStyle.ts`: `cellStyleFor(bg, border, dot, button)` を追加
  （CSS変数 `--cell-bg`/`--cell-border`/`--cell-dot`/`--cell-btn`、非hexは破棄）。
- `src/components/TerminalCell.vue`: `.cell` ルートに `:style="cellStyle"`。
  - `.cell` background/border、`.cell-dot` background、`.cell-btn` color を変数参照に。
  - status frame（`.cell.is-*`）と status dot（`.cell-dot.is-*`）は活動中に上書き＝
    フィードバック維持。custom は idle 時。

## 追加: row 2 / 単一ビューのヘッダーも対応
QA で 2 行目（`Terminal.vue` のヘッダー = grid row 2 + 単一ビュー）が未対応で白く浮い
ていたため、既存の `headerColor` / `headerTextColor` / `buttonColor` を同ヘッダーにも
適用（新フィールドなし、クライアント配線のみ）:
- `cellHeaderStyle.ts`: `terminalHeaderStyleFor(bg, text, button)` を追加。
- `Terminal.vue`: `dirHeaderColor` / `dirHeaderTextColor` / `dirButtonColor` props を
  追加、`.header` に `:style`、`.header` 背景・文字と `.icon-btn` 色を変数参照に。
- `TerminalCell.vue` / `App.vue`: dirConfig の header 色を props で渡す。

## テスト
- `server/dir-config.spec.ts`: 4 フィールドの読み込み（EMPTY / full config / public）。
- `src/components/cellHeaderStyle.spec.ts`: `cellStyleFor` / `terminalHeaderStyleFor`。
- `src/components/TerminalCell.spec.ts`: dir-config の 4 色が `.cell` に CSS変数として載る。
- `README.md`: 表に 4 行追加 + header 色の説明を両ヘッダー対応に更新。
