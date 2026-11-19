# 会話と成果物の紐付け（#3330）

親: #3327。設計は `docs/library-design.md`。

## 一つ目の PR（PR と会話の行き来）

- 索引は新しい表を作らない。会話の行に `prs`（会話記録の `pr-link` を集めた JSON）が既にあるので、`json_each` で引く（`conversationsForRepository`）
- GitHub ビューはリポジトリごとに一覧を出すので、問い合わせもリポジトリ単位で一度（`GET /api/library/repository-conversations?repo=owner/repo`）。PR ごとに聞くと行の数だけ往復する
- 「この PR を作った会話」は、その PR を記録した会話のうち **始まりがいちばん早いもの**。後からレビューや修正で戻ってきた会話より、開いた会話を選ぶ
- リポジトリ名は大文字小文字を区別しない（GitHub と同じ）。`owner/repo` 以外の形と、`.` だけの名前は 400
- ボタンは PR の行の横に置く。行そのものが GitHub へのリンクで、リンクの中にボタンは置けない
- 引けなかったときはボタンを出さないだけ。GitHub ビューの本分は PR の一覧
- 読む画面の灰色の一行の PR 番号はリンクにする。会話記録に書かれた URL なので、`https://github.com/` で始まるものだけ開く

## 二つ目の PR（変更したファイル）

`file-history-snapshot` / `~/.claude/file-history/` から、その会話が編集したファイルの一覧と各版の差分。閲覧だけで、ファイルを戻す操作は入れない（issue の推奨どおり、使われ方を見てから）。
