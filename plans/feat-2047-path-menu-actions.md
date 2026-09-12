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
- break-verify: suffix を `/action` に壊すと 1 本、項目ごと消すと 2 本 red になることを確認済み。
- **ブラウザでの実機確認はしていない**（マシン負荷が高かったため）。テンプレートに項目を 1 つ
  足しただけで新しいバインディングは無く、遷移先は unit test が押さえているが、実画面の
  見た目は未確認。PR 本文の Items to Confirm にも同じことを書いてある。

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
