# fix: 新しいタブのツールバーは `hidden` だけに頼らず、プレビューの HTML コピーは表示状態で複製する（#3258）

## 背景

#3252 で入れた、描画文書を単独のタブで開いたときのツールバー（描画 / ソースの切替と二つのコピー）に、
CodeRabbit がマージ直前に二件の軽微な指摘を残していた。

1. 切替は `hidden` 属性を付け外しするだけ。Markdown には生の HTML が書けるので、ファイルが
   `<style>[hidden]{display:block}</style>` を含むと、作者スタイルがブラウザ既定の `[hidden]` 規則に勝ち、
   ソースと描画の両方が見えたままになる。
2. 「プレビューをコピー」の HTML 側は描画ノードをそのまま複製する。ソース表示中は描画が `hidden` なので、
   `text/html` に `hidden` 付きのノードが入り、`hidden` を尊重する貼り付け先では中身が落ちる。
   既存の仕様はスクリプトの文字列しか見ておらず、どちらも固定されていなかった。

## 方針

- 隠すときは `hidden` 属性に加えて `style` 属性へ `display:none !important` を足す。インラインの `!important` は
  作者スタイルシートの `!important` にも勝つ。見せるときは、その要素が元から持っていた `style` 属性の文字列
  （ファイルの生 HTML が `style="display:flex"` を付けていた場合など）をそのまま戻す。覚えておくのはスクリプト内の
  `Map`（要素 → 元の `style` 属性）。
- ラッパーの外に並ぶ要素はファイルのもの。そこに `<form>` があると `<input name="style">` のような名前の入力が
  `el.style` / `el.hidden` / `el.nextElementSibling` / `el.innerText` を上書きする（DOM の上書き）。だから
  ファイル側の要素には要素のプロパティで触らず、`Element.prototype` の属性メソッドと取得子を `.call` で使う。
- ソースの `<pre>` は HTML の時点で属性とインラインの display の両方を持って出す（スクリプトが動く前の一瞬や、
  スクリプトが動かなかった場合にも効く）。
- `whileShown` は「隠れている要素だけ」を一時的に見せて戻す（見えている要素のインライン display を消さない）。
- `renderedHtml()`（HTML コピー）を `whileShown` で包む。複製には `hidden` もインライン display も残らない。

## 仕様書

- `test/server/files/renderedTabTools.spec.ts`: 文書の並び（`<pre>` の属性とインライン display）と、
  スクリプト本文が属性で隠し、原型経由でファイル側の要素に触り、`whileShown` で包んだ `renderedHtml` を持つこと。
  `el.hidden` などの直接の読み書きが本文に無いことも固定する。
- `test/src/renderedTabToolsScript.spec.ts`（新規、jsdom）: 生成した文書にスクリプトを実際に走らせ、
  初期状態、切替（優先度付きで隠れる・元の display が戻る）、ソース表示中の「プレビューをコピー」で
  `ClipboardItem` の `text/html` に `hidden` も `display` も無く、コピー後も描画が隠れたままであること。
  名前を上書きする入力を持つ `<form>` が横にあっても、切替が例外を出さず、入力の中へ降りないこと。

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → 関連仕様。実機では、`[hidden]{display:block}` と
`style="display:flex"` の要素を含む Markdown をタブで開き、ソース表示で描画が消えること、戻すと要素の display が
戻ること、ソース表示中のプレビューコピーの HTML に `hidden` が無いことを Playwright で確認する。
