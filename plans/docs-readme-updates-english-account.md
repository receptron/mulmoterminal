# docs: Updates 行に英語アカウント @mulmocast を併記する

対応 issue: #1974

## 背景

README の Updates 行が、英語の読者に「更新は日本語で流れます」とだけ伝えている。
英語アカウント [@mulmocast](https://x.com/mulmocast) は 2026-08 から動いていて機能クリップや
英語の投稿を出しているが、README からは辿れない。

この行の重みは、更新を知る手段が他にほとんど無いことから来ている。2026-09-02 時点で
star は 200、watch は 1。star は購読ではないので、リリースを出しても star を付けた 200 人には
通知が飛ばない。気づけるのは自分から見に来た人だけで、その人が最初に読むのがこの行になる。

## 方針

@SingularitySoci を残したまま @mulmocast を併記する。置き換えではなく、
「日本語は日本語アカウント、英語は英語アカウント」と読める形にする。

## 対象

issue 本文が挙げているのは README の 2 箇所だが、同じ案内が公開サイト側にもあり、
`docs/guide/{en,ja}` は対訳として同期を保つ決まりなので、そちらも同じラウンドで揃える。
対象は 4 ファイル 6 箇所。

| ファイル | 箇所 | 直す理由 |
| --- | --- | --- |
| `README.md` | Documentation 節の Updates 行 | issue 本文が指した箇所 |
| `README.md` | 末尾の Links 節の Updates 行 | issue 本文が指した箇所 |
| `docs/guide/en/index.md` | What's new ブロックの X の行 | README と同文言。英語読者に英語の窓口が伝わらない |
| `docs/guide/ja/index.md` | 同上の対訳 | en と対訳で同期を保つ。日本語読者にも英語アカウントの存在を伝える |
| `docs/index.md` | トップの引用ブロック（日本語段落・英語段落） | 同じ案内。英語段落は "(in Japanese)" とだけ書いている |
| `docs/index.md` | 末尾のフッター行 | 同じ案内 |

対象外: `docs/guide/{en,ja}/v*.md` と `docs/ChangeLog.md`。
日付入りのリリースページと過去のリリースノートは、その時点のスナップショットとして
書き換えない決まりのため。

## 確認すること

- リンク先が `https://x.com/mulmocast` で解決すること
- en / ja のガイド index が、変更後も同じことを言っていること
