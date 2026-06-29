# feat: テーマカラー（4プリセット配色）

作成日: 2026-06-21

## User Prompt

- 色を変えられるようにしたい。テーマカラー的な。
- 4パターンくらいの配色が欲しい。それができるか調査を。
- 配色の方向性: 全く異なる4世界観 / 切替UI: 設定モーダルに追加

## ゴール

アプリ全体の配色を、見た目の世界観ごとに切り替えられる **4テーマ** を用意する。
選択は localStorage に永続化し、設定モーダルから切り替える。

## 現状調査

- 配色は **63種類の hex 値が15ファイルの `<style scoped>` に直書き**（Tailwind は導入済みだが配色はほぼ手書きCSS）。
- 意味ごとにきれいにクラスタリングでき、**約18個のセマンティックトークン（CSS変数）** に集約可能。
- 非CSSの色指定は **xterm（`Terminal.vue` の JS テーマオブジェクト）のみ**。プラグイン iframe（白背景）は意図的にアプリ chrome と分離、Shadow DOM / srcdoc にハードコード色なし。
- `SettingsModal` は現状 `GridView`（グリッド表示）の⚙からしか開けない。単一表示にも⚙を追加する必要がある。

## トークン設計（セマンティック）

テーマで変わるトークン:

| トークン | 用途 |
| --- | --- |
| `--bg-base` | 最下層背景（body / ターミナル / モーダル） |
| `--bg-panel` | パネル / ツールバー / ヘッダ / サイドバー |
| `--bg-elevated` | ボタン / 二次サーフェス / タブ |
| `--bg-input` | 入力フィールド |
| `--bg-hover` | インタラクティブ要素の hover 背景 |
| `--border` | 標準ボーダー / 区切り線 |
| `--accent` | テーマカラー核（focus / active / リンク） |
| `--accent-bg` | アクセント塗り（primary ボタン / active タブ） |
| `--accent-bg-hover` | アクセント塗りの hover |
| `--on-accent` | アクセント面上のテキスト |
| `--text` | 一次テキスト |
| `--text-muted` | 二次テキスト |
| `--text-dim` | 三次 / ヒント |
| `--term-fg` | xterm 前景 |
| `--term-selection` | xterm 選択範囲 |

ステータス系（**全テーマ共通で固定** = 意味が色に紐づくため）:

`--success` / `--success-bg` / `--warn` / `--warn-bg` / `--error` / `--error-strong` / `--error-bg`

## 4テーマ

暗→明・寒色→暖色で明確に差をつける（ユーザー要望: 明るい背景の配色が欲しい / 変化が小さい）。

1. **Midnight**（デフォルト・現状維持）— 紺/藍のダーク。accent 青。
2. **Nord** — クールなスレート（中間の暗さ）+ フロストシアン。
3. **Daylight** — 明るい寒色。白パネル + 淡グレー背景 + 鮮やかな青。
4. **Solarized Light** — 明るい暖色。クリーム背景 + Solarized ブルー。

### 明テーマ対応（落とし穴と対策）

- **ステータス色をテーマ連動化**: 暗テーマは「暗背景ピル + 明テキスト」、明テーマは「淡色ピル + 濃テキスト」。`:root` に暗版を定義し、`[data-theme="daylight"], [data-theme="solarized"]` で淡色版を上書き。
- **hover/選択時テキスト**: 一括置換で `#fff`→`--on-accent` にした箇所のうち、背景が `--accent-bg` でない（hover/選択/waiting）9箇所を `--text` に修正（明背景で白文字が消えるため）。`--on-accent` は `--accent-bg` 上の3箇所のみ。
- **xterm の ANSI 16色**: 明テーマは light 端末向けパレットを指定（bright-white を濃色にマップ）し、色付きTUI出力が明背景で潰れないようにする。

## 実装ステップ

1. `src/composables/useTheme.ts` を新規作成
   - 4テーマ定義（id, label, スウォッチ色, xterm テーマ）
   - module-level の reactive `themeId`、localStorage 永続化、`document.documentElement` への `data-theme` 適用
   - `themes` / `themeId` / `setTheme` / `xtermTheme()` を公開
2. `src/style.css` に `:root` のセマンティック変数（Midnight）+ `:root[data-theme="..."]` 上書き + 固定ステータストークンを定義
3. 15ファイルの直書き hex を `var(--token)` に置換（Midnight が現状と視覚的に一致するようマッピング）
4. `Terminal.vue` を xterm テーマと連動（`themeId` を watch して `term.options.theme` をライブ更新）
5. `SettingsModal.vue` に「Theme」セクション（4スウォッチ選択）を追加。`useTheme` で自己完結（新規 props 無し）。`presets` を任意化。
6. 到達性: `App.vue` 単一表示ツールバーに⚙を追加。config ロード/保存を `useAppConfig` composable に切り出し、`App.vue` と `GridView.vue` で共有（DRY）。
7. `main.ts` で `useTheme` を早期初期化（マウント前に `data-theme` 適用しフラッシュ回避）。

## 確認ポイント（レビュー観点）

- Midnight テーマが既存の見た目と差異ないか。
- xterm のテーマ切替がライブで反映されるか（開いている端末も即時）。
- 単一表示 / グリッド表示の両方からテーマ変更できるか。
- ステータス色（接続状態・エラー）が全テーマで判読できるか。
