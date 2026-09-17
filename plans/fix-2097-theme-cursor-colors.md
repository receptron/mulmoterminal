# fix #2097 — カーソル色をテーマ側で決められるようにする

## 症状

明るいテーマ（Daylight / Solarized、およびそれを `extends` したカスタムテーマ）で、
カーソルの下の文字が読めない。

xterm はカーソルのセルを「`cursor` 色のブロック + その上に `cursorAccent` 色のグリフ」として
描く。組み込み 4 テーマはいずれも `term.cursor` を `foreground` と同じ値にしており、
`cursorAccent` はどれも書いていない。よって xterm の既定値 `#000000` が使われ、
明るいテーマでは「暗いブロックの上に黒い字」になる。

さらに、この 2 色を全セルに効かせる手段が無い。

- `themes[].colors` は `THEME_VAR_KEYS`（CSS 変数 20 個）だけを受け付け、そのうち xterm に届くのは
  `--bg-base` / `--term-fg` / `--term-selection` の 3 つ。`cursor` / `cursorAccent` の置き場が無い。
- 唯一書ける場所はディレクトリ単位の `.mulmoterminal.json` の `colors`（`THEME_COLOR_KEYS`）。
  全ディレクトリに同じファイルを置く必要があり、git 管理下では `.local` と `.git/info/exclude` まで要る。

## 方針

issue の案 1（`themes[].term`）を採る。テーマは既に「xterm パレットを運ぶもの」
（`Theme["term"]`）なので名前も置き場もそこに揃う。案 2（config 直下のグローバル `colors`）は
ディレクトリ設定と同じキーがテーマと無関係に 2 段重なることになり、テーマを切り替えても
カーソルだけ前のテーマの色が残る、という分かりにくさが出る。

3 つに分ける。

### A. `themes[].term` — xterm パレットの明示的な上書き

`THEME_COLOR_KEYS`（ディレクトリの `colors` と同じ集合）を `paletteColor` で検証して受ける。
ANSI 16 色も含まれるので、`extends` 先の ANSI を一部だけ差し替える、という今まで出来なかったことも
同時に出来るようになる。

優先順位（`termThemeFor`）:

    extends 先の term  <  CSS 変数からの導出  <  themes[].term  <  dir の colors

いちばん狭いものが勝つ、という既存の順序をそのまま延長する。

### B. 導出に `cursor` / `cursorAccent` を足す

`termThemeFromVars` は今 `background` / `foreground` / `selectionBackground` の 3 つを
CSS 変数から導出している。ここに

- `cursor` ← `--term-fg`
- `cursorAccent` ← `--bg-base`

を足す。組み込みテーマが全部 `cursor === foreground` にしている規約をそのまま再現したもので、
`cursorAccent` はその反転。カーソルのセルが「文字色と背景色を入れ替えただけ」になるので、
通常の文字が読める限りカーソル下の文字も読める。

これが無いと、A だけでは「明るいカスタムテーマが暗い組み込みを `extends` している」ケースが
依然として読めないままになる（`cursor` は base から継がれるため）。

### C. 組み込み 4 テーマに `cursorAccent` を書く

`termThemeFor` は組み込みが選ばれているとき導出を通らず `builtin.term` をそのまま返すので、
B とは別に要る。値は各テーマの `background`。B の導出規則と同じ「`cursorAccent` は背景」に
揃えるため、暗い 2 つ（Midnight / Nord）にも書く — 既定の `#000000` から各テーマの
ほぼ黒い背景色に変わるだけで、見た目は変わらない。

## 触るファイル

- `common/themeVars.ts` — `CustomThemeInput.term`、`termThemeFromVars` の導出 2 色追加
- `server/config/config-schema.ts` — `customThemeSchema` に `term`
- `src/composables/customThemes.ts` — `customTermTheme` が `term` を返す / クライアント側のキー再検査
- `src/composables/useTheme.ts` — `THEMES` の `cursorAccent`、`termThemeFor` の合成順
- `test/` — 上記それぞれ
- `server/skills/mulmoterminal-theme/SKILL.md`、`docs/guide/{en,ja}/config.md` — スキーマ追記

## 確認

- `yarn test` / `lint` / `typecheck` / `build`
- 実際に Daylight を選んでカーソル上の文字が読めること、`term` を書いた theme がその色になることを
  ブラウザで確認（スクリーンショット）
