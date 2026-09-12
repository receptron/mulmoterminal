# #2047 — パスメニューに GitHub Actions を足す

## 現状

セルヘッダーのパスメニュー（`src/components/TerminalCell.vue` の `#header-lead`）は
ローカル 3 項目（Reveal / Browse / New terminal）のあとに、`githubUrl` が解決できたときだけ
Repository / Issues / Pull requests を出す。いずれも `openGithub(suffix)` に GitHub の
web URL への suffix を渡すだけの構造。

## 変更

`openGithub("/actions")` を呼ぶ **Actions** 項目を Pull requests の次に足す。GitHub 自身の
タブ順（Code / Issues / Pull requests / Actions）に合わせた位置。

- ゲートは既存の `v-if="githubUrl"` セクションをそのまま使う。`githubUrl` は
  `server/git/gitRemote.ts` で forge が github のときだけ埋まるので、GitLab では
  セクションごと出ない = 壊れたリンクは出ない。
- アイコンは Material Symbols の `play_circle`。`material-symbols` はフル版を読み込んで
  いるのでサブセット漏れは無い。

## 検証

- `test/src/components/TerminalCell.spec.ts` の 2 本を更新:
  - メニュー項目のラベル列挙に `"Actions"` を追加
  - 遷移先を確かめるテストに `<repo>/actions` を追加
- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`
- break-verify（すべてツリーを復元して byte 一致を確認）:
  suffix を `/action` に壊すと 1 本、項目ごと消すと 2 本、配置モデルをウィンドウ基準に
  戻すと 3 本、cap を外すと 2 本、ウィンドウ側の clamp を落とすと 1 本、上端の clamp を
  落とすと 1 本 red。
- 実ブラウザ実測: puppeteer（headless Chromium）+ `dist/assets/index-*.css`。ハーネスは
  セルのルートクラスと `overflow-hidden` をそのまま再現し、セル高を 1px ずつ掃いて
  `document.elementFromPoint` で最下行が hit できるかを判定している。
- **ブラウザでの実機確認はしていない**（マシン負荷が高かったため）。テンプレートに項目を 1 つ
  足しただけで新しいバインディングは無く、遷移先は unit test が押さえているが、実画面の
  見た目は未確認。PR 本文の Items to Confirm にも同じことを書いてある。

## メニューの高さ（Codex round 2 で判明）

7 行目を足すと、メニューが**セル**からはみ出す帯ができる。clip しているのはウィンドウでは
なく **セルのルート（`overflow-hidden`）** で、Chromium（puppeteer）+ ビルド済み
スタイルシートで実測した数値は:

| | 実測 |
|---|---|
| 1 行の高さ | 27px |
| メニューの border box | 6 行 181px → 7 行 208px |
| 最下行が hit できなくなるセル高 | 6 行なら 217px 未満、**7 行だと 244px 未満** |
| 対策後（セルに合わせて cap + `overflow-y-auto`） | セル高 120px まで最下行に到達できる |

つまり **セル高 217〜243px が今回の退行帯**で、3x3 タイルは 800px 前後のウィンドウで
約 245px なのでふつうに踏む。対策は #2003 の純関数 `menuPlacement()` を再利用し、
**セルの矩形とウィンドウの交差**（`max(box.top,0)` 〜 `min(box.bottom,innerHeight)`）を
「入る箱」として渡す。セルだけだと画面外にぶら下がったセルで過大に、ウィンドウだけだと
タイル表示で無意味になる（後者が Codex の当初案で、実測で効かないことを確認した）。

`openAskMenu` はウィンドウ基準のまま。このPRが依頼された範囲外の面の挙動変更になるため
触らない（Codex も「finding ではない」と合意）。

## ドキュメント

パスメニューの中身を書いている **生きているガイド 4 面** も同時に直す
（`docs/guide/{en,ja}/header.md` と `docs/guide/{en,ja}/basics.md`）。
日付入りのリリースページ（`v4.4.0.md`）はスナップショットなので触らない。
`docs/guide/images/header-path-menu.png` は GitHub リモートの無いディレクトリで撮られていて
ローカル 3 項目しか写っていないため、この変更では stale にならない。

## やらないこと

- 他画面への展開（同じメニューは他に無い）。
- 非 GitHub forge 向けの CI リンク（GitLab の `/-/pipelines` 等）。`githubUrl` が
  そもそも GitHub 限定なので、対応するなら別 issue。
