# feat #279: セルヘッダーの背景色・文字色を .mulmoterminal.json で指定

## 要望
grid view などのターミナルセルのヘッダー（`cell-header`）の背景色・文字色を
`.mulmoterminal.json` で変えられるようにする。バッジ色（`badgeColor`）は既に可。

## 実装
### 設定（サーバ: `server/dir-config.ts`）
- `DirConfig` / `PublicDirConfig` に `headerColor` / `headerTextColor` を追加。
- `sanitizeColor`（`#rrggbb` のみ、小文字化）で検証。`EMPTY` / `loadDirConfig` /
  `publicDirConfig` を更新。

### クライアント設定（`src/composables/useDirConfig.ts`）
- `DirConfig` / `EMPTY` / `parse()` に両フィールドを追加。

### 適用（`src/components/TerminalCell.vue`）
- 純粋ヘルパー `cellHeaderStyle.ts` の `headerStyleFor(bg, fg)` が CSS変数
  `--cell-header-bg` / `--cell-header-fg` を返す（非hexは破棄）。
- `cell-header` に `:style="headerStyle"`。
- CSS: `background: var(--cell-header-bg, var(--bg-panel))`、
  `.cell-dir` / `.cell-prompt` の色を `var(--cell-header-fg, <既定>)`。
- status tint（`.cell-header.is-working` 等）は活動中に背景を上書き＝
  フィードバック維持。idle 時にカスタム背景。

## テスト
- `server/dir-config.spec.ts`: full config に header 色、`#rrggbb` 以外は破棄。
- `src/components/cellHeaderStyle.spec.ts`: マッピング / 片方のみ / 空 / 非hex破棄。
- `src/components/TerminalCell.spec.ts`: dir-config から header 色が CSS変数として
  header に載る。

## ドキュメント
- `README.md` の `.mulmoterminal.json` 表に 2 行追加。

## スコープ外（別途優先度確認）
単一ビュー Terminal.vue ヘッダー / CommandCell・LauncherCell ヘッダー / セル本体
背景 / ボーダー / ドット等の追加カスタマイズ。
