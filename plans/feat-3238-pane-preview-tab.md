# feat: ペインのヘッダから Preview を新しいタブで開く（#3238 の分割 3）

## 背景

右ペインの Markdown は Preview（埋め込み版の文書を iframe で表示）で読める。新しいタブで開く
形（ツールバー付きの文書、分割 1 で入った切り替えとコピーのボタンを持つ）は、ターミナルの
リンクをクリックまたは右クリック（分割 2）したときにしか届かず、ペインで開いているファイルを
そのままタブに出す手段が無かった。

## 方針

- ペインのヘッダに「Preview を新しいタブで開く」ボタンを一つ置く。押すと、そのファイルの
  タブ用の文書（`/api/files/browse/md?cwd=…&path=…`）を新しいタブで開く。
- 開く URL はタブ用のもので、ペインの iframe が使う埋め込み版の URL（`embed=1`、`v`、
  配色、token 付き）ではない。埋め込み版はツールバーを持たず、token は URL の外に出しては
  いけない値なので、タブには一切載せない。
- 対象は、サーバーが描画する文書を持つ種類（Markdown、JSON、CSV / TSV）。これらはタブで同じ
  ツールバーを持つ（分割 1）。HTML ページ、SVG、画像などはタブ用の文書を持たないので出さない。
- 根を持たないペイン（`cwd` が無い）では出さない。経路は根が無いと答えられない。
- 開き方は、アプリの他の「新しいタブで開く」と同じ（`window.open(url, "_blank", "noopener,noreferrer")`）。
- 全画面の `/files` も同じ部品を使うので、そこにも同じボタンが出る。開く文書の根はその表示の
  根と同じで、届く範囲は変わらない（`docs/file-surfaces.md` の規則のまま）。
- 一ファイル表示（分割 5）が入ったら、基点をファイル自身のディレクトリにする。この PR の
  時点では一ファイル表示が無いので、根は常にペインの根。

## 仕組み

- `src/components/filesPreviewSrc.ts`: `previewTabUrl(kind, cwd, pathRel)` を足す。種類から
  経路を選び、`browseQuery` で `cwd` と `path` だけを付ける。種類が描画されるものでない、
  または根が無いときは null。
- `src/components/FilesPane.vue`: 算出値 `previewTab` を持ち、null でないときヘッダの
  Edit / Preview の切り替えの隣に `FilesToolbarButton`（アイコン `open_in_new`）を出す。
  押すと `window.open`。
- `src/i18n/tips/{en,ja,ko,zh-CN,zh-TW}.ts`: 説明文 `tips.panes.previewTab`。

## 試験

- `filesPreviewSrc.spec.ts`: 種類ごとの経路、`embed` / `v` / token を載せないこと、根が無い
  と null、描画されない種類は null、クエリの escape。
- `filesPanePreviewTab.spec.ts`: `.md` を開くとボタンが出て、押すと `window.open` がタブ用の
  URL と `_blank`、`noopener,noreferrer` で呼ばれる。`.ts` や `.html` では出ない。`.csv` は
  table の経路。
- 実機: 使い捨ての HOME でサーバーを起動し、Playwright でペインの `.md` を開いてボタンを押し、
  開いたタブの URL に `embed` が無く、分割 1 のツールバー（`.tab-tools`）があることを確かめる。

## 文書

- `docs/guide/{en,ja}/features.md`: ペインの項にボタンの説明を一行。
- `README.md`: 「Clicking a file path」の表の近くに、ペインからも同じタブに出せる旨を一行。
- `docs/file-surfaces.md`: 右ペインがタブの面に文書を渡すときの根は自分の根である旨を一行。
