# feat: worklog タスクが週次ページも index.md に #worklog 付きで登録する

## User Prompt

> 個別に生成されるwikiもほしい
> 古いのをサポートしてないなら、ここのlocalのだけデータ更新して
> で、wikiもなおしてね。バックエンドもかな。

## 背景

Wiki の索引・タグフィルタは `index.md` の「## ページ一覧」から `parseIndexEntries` で生成され、
タグは各行の `#token`（`extractHashTags`）から取られる。ページ frontmatter のタグは索引には読まれない。

現行の WORKLOG_PROMPT は「週次ページ自体は index.md に増やさない（ハブと #worklog タグからたどれる）」
と明示していたが、週次ページが index.md に無いため **#worklog フィルタに個別ページが出ない**
（「タグからたどれる」の記述も実態と不一致）。

## 修正（バックエンド = WORKLOG_PROMPT）

`server/backends/worklog.ts` の prompt を2箇所変更:
1. 書き込み対象スコープ行: index.md を「一覧ハブ**および週次ページ**のエントリ追記の目的で」触れてよいに緩和。
2. step 7b: ハブに加え、**今回の週次ページのエントリも index.md に #worklog 付きで登録**する指示に変更
   （形式 `- [作業ログ YYYY-Www](pages/dev-log-YYYY-www.md) — … #worklog`）。既存の記載・順序は不変。

これで次回以降の週次ページは自動で #worklog 索引に並ぶ。既存の w29/w30 は local データを手動更新済み
（`~/mulmoclaude/data/wiki/index.md`。リポ変更ではない）。

## 検証

- worklog.spec（7件）パス。prompt の injection 対策・書き込み対象限定・ステップ参照フレーズは保持。
- typecheck / build パス。docs は worklog の内部 index 挙動を記載していないため更新不要。
