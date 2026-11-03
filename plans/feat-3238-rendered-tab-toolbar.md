# feat: 新しいタブで開いた文書にツールバー（表示の切り替えとコピー）を付ける（#3238 の分割 1）

## 背景

ターミナルのファイルリンクをペインが取れないとき、`.md` / `.json` / `.csv` / `.tsv` はレンダリング済みの
文書として新しいタブに開く（`/api/files/browse/md` など、`mountRenderedRoute`）。その文書は
`Content-Security-Policy: sandbox` でスクリプトが動かず、ツールバーも無い。読むだけなら足りるが、生の
テキストを取り出す手段が無い（#3238）。

## 方針

- 開く条件は変えない。変えるのは、埋め込みでない応答（＝新しいタブ）の文書の中身と、その CSP だけ。
- 文書の先頭にツールバー: 「プレビュー / ソース」の切り替え（JSON は「整形表示」、表は「表」）と、
  ソース用・プレビュー用の二つのコピーボタン。どちらの表示でも両方押せる。
  - ソースのコピーは生のテキスト。プレビューのコピーは表示どおりのテキスト（`text/plain`）と書式付き
    （`text/html`）を一緒に載せる。Clipboard API が使えない・拒まれたときは、選択して `execCommand("copy")` に後退。
- CSP はペインの埋め込み版と同じ `sandbox allow-scripts; script-src 'nonce-…'`（`mdPreviewEmbed.ts`）。
  許すのは自前のスクリプト一本だけで、ファイルの中のスクリプトは nonce を持たないので動かない。
- ペインの Preview はツールバーを持たない。`.md` は従来どおり `embed=1` で埋め込み版を受け取り、JSON と表も
  `embed=1` を付けて「ペインの要求」と名乗る。埋め込み文書を持たない経路の `embed=1` は、従来と同じ
  `sandbox` の素の文書を返す（ツールバー無し、スクリプト無し）。
- ラベルの言語は `Accept-Language` から決める（タブは独立した文書で、アプリの言語設定を知れない。配色が
  システム設定に従うのと同じ理屈）。英語・日本語・韓国語・簡体字・繁体字。

## 変更

- `server/files/renderedTabTools.ts`（新規、純関数）: ラベル表と言語の選択、ツールバーの HTML、ソース表示の
  `<pre>`、スクリプト（定数一本。ファイル由来の値もラベルも埋め込まない。ラベルは文書の属性から読む）。
  Markdown の生 HTML は描画の包みを閉じて、同じ id やクラスの偽物を `body` の直下に置けるので、要素は id や
  クラスで探さない。外殻はツールバー・ソース・描画の包み・スクリプトの順に出し（ファイルの中身より前に
  サーバー側の三要素が必ず来る）、スクリプトは `body` の先頭三子を位置で取り、自分は `currentScript` で
  見つけ、ボタンの検索はツールバーの中に限る。描画は「包みからスクリプトまでの兄弟全部」として扱う
  （ファイルが包みを早く閉じても、残りも一緒に隠し、一緒にコピーする）。
- 後退経路のコピー: ソースは正確な文字列を入れた一時的な `textarea` を選択してコピーする（要素の中身の
  選択は最後の文字で終わり、末尾の改行が落ちる）。描画は範囲選択のまま（書式が目的）。
- ソースの文字列はツールバーの中の JSON データブロック（`<script type="application/json" data-tab-source>`。
  実行されないので nonce 不要。`<` は `\u003c` に書く）から読む。表示用の `<pre>` は HTML の解析で
  CRLF が LF に、U+0000 が置換文字に変わるので、「そのまま」のコピーには使えない。
- `server/files/renderedDoc.ts`: JSON と表の本文と見た目を外殻から分け、ペイン用の外殻とタブ用の外殻の両方が
  同じ本文を使えるようにする。既存の `jsonHtmlDoc` / `tableHtmlDoc` はその薄い包み。
- `server/files/files-browse.ts`: `mountRenderedRoute` が三つの形を返す。埋め込み文書のある経路の `embed=1`
  （従来どおり）、埋め込み文書の無い経路の `embed=1`（素の文書、従来どおり）、それ以外（タブ: ツールバー付き、
  nonce 付き CSP）。
- `src/components/filesPreviewSrc.ts`: JSON と表の Preview の URL にも `embed=1`。
- 仕様書: `renderedTabTools.spec.ts`（新規）、`renderedTabToolsDom.spec.ts`（新規、jsdom で敵対的な文書を
  解析し、先頭三子がサーバー側の要素であること）、`files-browse-tab.spec.ts`（新規、タブの文書）、
  `files-browse.spec.ts` / `files-browse-json.spec.ts` / `previewMermaidRoute.spec.ts` / `previewMathRoute.spec.ts` /
  `previewCodeNumbering.spec.ts` の素の文書の断定を更新、`filesPreviewSrc.spec.ts`。
- 文書: README の "Clicking a file path" の行、`docs/guide/{en,ja}/features.md`、`docs/terminal-notes.md`、
  `docs/file-surfaces.md`、`renderedDoc.ts` と `filesPreviewSrc.ts` の冒頭コメント。

## 確かめること

- 不透明オリジンの最上位文書で `navigator.clipboard.writeText` / `write` が通るか（Chromium と WebKit で実測）。
  通らないときの後退（選択 + `execCommand`）が効くか。
- ペインの Preview（`.md` / JSON / 表）の文書が、バイト単位で従来どおりか。
- ファイルの中の `<script>` / `onerror=` が、タブでも動かないこと（nonce は自前の一本だけ）。

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`。Playwright で実際の文書を開き、
両方のコピーボタンを押してクリップボードの中身を読む。
