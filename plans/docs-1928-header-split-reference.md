# docs(#1928): ヘッダーのページを入門とリファレンスに分割する

## 何をするか

`docs/guide/{ja,en}/header.md`（318 / 324 行）を 2 ページに分け、実装にあってドキュメントに無い
挙動 3 つを埋める。

| | 章 | 読み方 |
|---|---|---|
| `header.md`（残す・入門） | 1 ヘッダーを読む / 2 最初のボタン / 3 アイコン / 4 `run` の4種類 | **上から読む** |
| `header-reference.md`（新規） | 5 `${変数}` / 6 `when` / 7 並び順とマージ / 8 チップ / 9 Skill メニュー / 10 レシピ集 | **引く** |

## なぜこの形か

境界は「読み方が変わる場所」に置く。§1〜4 は**手を動かせば分かる**（1 個作って押してみる）。
§5 以降は**書く前に引く**（変数名は何があったか、`when` はどう書くか）。いま後者を読むために
前者をスクロールで通り過ぎている。

行数で割るのではないので、§4 の `run` は全部入門に残す。`run` を選ぶのは「作る」作業の一部で、
リファレンスを引く作業ではない。

## 決定

### D1: アンカーは移動先でも同じ ID を保つ

`#builtin-chips` `#custom-chips` `#chips` `#vars` `#when` `#vars-when` `#order-merge` `#skills`
はリファレンス側でそのまま使う。ページが変わるので**参照元の URL は直す必要がある**が、
ID を変えなければ直しは「ファイル名だけ」で済む。

外部からの被リンク（既存ページ）:

| アンカー | 参照元 | 移動する？ |
|---|---|---|
| `header.html#builtin-chips` | `ja/worktree.md:120`, `en/worktree.md:118` | **する** → 直す |
| `header.html#replace` | `ja/v4.14.0.md:46`, `en/v4.14.0.md:47` | しない（§2 は残る） |
| `header.html#run-action` | `ja/v4.14.0.md:88,137`, `en/v4.14.0.md:90,140` | しない（§4 は残る） |

直すのは worktree.md の 2 箇所（日英）だけ。**リリースノート（v4.14.0）は触らない** —— 過去の版の
記述で、当時の URL のまま残すのが正しい……のだが、リンク切れは読者には同じことなので、
**アンカー先が残る側に居ることを確認済み**。触らなくてよい。

### D2: `nav_order` は 10 の次に 11 を挿し、以降を +1 しない

`header.md` = 10（据え置き）、`header-reference.md` = **10.5**。

Just the Docs は `nav_order` に小数を使える。以降のページ（notifications 11 / phone 12 / …）を
全部ずらすと、そのコミットが「9 ファイルの nav_order 変更」で埋まって、レビューで本題が見えなく
なる。小数のほうが差分が小さい。

### D3: リファレンス冒頭に「入門を先に」を置く

リファレンスに直接来た人が、`buttons` を書くと既定が消える（§2 の落とし穴）を知らずに書き始めると
ヘッダーを壊す。冒頭 1 行で入門へ送る。

## 埋める穴

### 1. `when` の記法が半分しか書かれていない

実装（`server/config/header-resolve.ts`）は現行ドキュメントに無いものを受ける:

| 記法 | 意味 |
|---|---|
| `!isGitRepo` | git リポジトリ**でない**とき |
| `key != value` | 不一致 |
| **`repo != `**（右辺を空） | **「解決できる値がある」** |
| 括弧 | **使えない**（書かれていない） |

3 つ目が実害。GitHub を開くボタンを `"when": "isGitRepo"` にすると、remote が無い / GitHub 以外の
remote のリポジトリでもボタンが出て、`${repo}` が空に解決されて `https://github.com/` という
死んだリンクになる。**「git リポジトリか」と「GitHub の repo 名が取れるか」は別物**、という
1 文と実例 JSON を入れる。

### 2. 未知の `${変数}` はリテラルで残る

```js
// server/config/header-resolve.ts:33
// Replace known ${vars}; leave an unknown ${x} literal so a typo is visible rather than silently blank.
```

`${braneh}` は空にならず `${braneh}` のまま出る。**意図的な設計**（タイプミスを見せる）。
書かれていないので、見た人はバグだと思う。

### 3. 変数 12 個に説明が無い

現行は名前の羅列。`varValue` テーブル（`header-resolve.ts:12-30`）を正として、
**意味・空になる条件**の表にする。`null` は空文字に潰れる（`value === null ? "" : String(value)`）
ので、「git リポジトリでなければ `branch` は空」が表で分かるようにする。

## 触らないもの

**チップ節は現状で正しい。** 実装と突き合わせ済み:

- スキーマ `BUILTIN_CHIPS` は **9 個**（`server/config/config-schema.ts:49`）
- 1 段目に配置されるのは **6 個**（`src/components/TerminalCell.vue:254`
  `ROW1_BUILTIN_CHIPS = {git, work, diff, ctx, usage, env}`）
- 差の `dir` / `status` / `tools` は構造として常に出るので、書いても効かず書かなくても消えない

現行ドキュメントの「効くのは 6 つだけ」の表はこのとおり。**分割時に落とさないよう、そのまま運ぶ。**

（`.claude/skills/mulmoterminal-header` のチップ一覧は 8 個で `env` が欠けており古い。
このリポジトリの外なので、ここでは直さない。）

## 受け入れ条件

- [ ] `header.md` が §1〜4、`header-reference.md` が §5〜10 に分かれている（日英とも）
- [ ] リファレンスの章番号が **5 から始まり**、入門の 1〜4 から通しで読める
- [ ] 相互リンク（入門の末尾 → リファレンス、リファレンス冒頭 → 入門）
- [ ] `when` に `!` / `!=` / 空右辺 / 括弧不可 が、GitHub ボタンの実例つきで載っている
- [ ] 未知変数がリテラルで残ることが書かれている
- [ ] 変数 12 個が、意味と「空になる条件」つきの表になっている
- [ ] レシピ集に、そのまま貼れる `.mulmoterminal.json` が 1 つ以上ある
- [ ] `ja/worktree.md` `en/worktree.md` の `header.html#builtin-chips` が
      `header-reference.html#builtin-chips` に直っている
- [ ] `nav_order` が 10 → 10.5 → 11 で、他のページを動かしていない
