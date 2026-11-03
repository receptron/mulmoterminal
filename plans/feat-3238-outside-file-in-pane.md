# feat: セルの外のファイルをペインに一ファイルで開く（#3238 の分割 5）

## 背景

ターミナルに出たパスがセルのディレクトリの外（絶対パス、`../` で上に出るパス、`~/…`）を指すとき、
クリックは常にペインを素通りしていた（`tryOpenInPane` は `pathWithinCwd` が null なら辞退）。
Markdown・JSON・表・ソースは新しいタブか全画面の Files ビューに、ページ・画像・PDF・動画・音声は
一ファイル用の許可（`/api/files/grant`）で新しいタブに行く。

issue の目標の規則: **クリックしたファイルは、ペインが表示できる限りターミナルの横に開く。** 外の
ファイルも、ペインが扱える種類なら横に開く。

## 方針

- 外のテキスト系のファイル（Markdown・JSON・CSV / TSV・ソース・`.txt`、タブが表示できない種類も含む）は、
  ペインに**そのファイルだけ**を開く。ツリーの根は動かさず、ツリーにはそのファイルは出ない。編集・保存・
  Preview の切り替え・コピー・Preview を新しいタブで開くボタンは、セルの中のファイルと同じに効く。
- ページ・画像・PDF・SVG・動画・音声（`grantKind` が非 null の種類）は従来どおり一ファイル用の許可で
  新しいタブ。ペインはそれらを `/api/files/raw` と page の経路から描くが、その二つは配信の基点を
  ワークスペースと稼働中のセッションのディレクトリに限っているため、外のファイルは描けない。
- 封じ込め: 一ファイル表示の基点はファイル自身のディレクトリ（`rebaseOutsideCwd` の `base`）で、
  ブラウズ経路（`/api/files/browse/*`）に `cwd=<そのディレクトリ>&path=<名前>` を渡す。経路の側は今まで
  どおり「`path` が `cwd` の下にあること」を守るだけで、`cwd` 自体は任意の既存ディレクトリを受ける（全画面の
  Files ビューと同じ。同一オリジンのコードは以前からブラウズ経路でどのファイルも読めるので、サーバーの
  届く範囲は広がらない）。ペインが差し出すのはその一ファイルだけ: 一覧も、ツリーも、履歴も、そのディレクトリ
  には及ばない。`docs/file-surfaces.md` の表に行を足し、「誰がパスを選んだか」（エージェントが印字し、
  ユーザーがクリックして選んだ一ファイル）と「届く範囲」（その一ファイル。サーバー側の基点はファイルの
  ディレクトリで、経路としては全画面と同じ）を書く。
- 編集と保存: ブラウズ経路の `write` は `baseVersion` 付きの条件付き書き込みで、ディスク側が変わっていれば
  409 を返す。一ファイル表示もその経路をそのまま使うので、自動保存（ペインを離れるときの flush）と 409 の
  扱いはセルの中のファイルと同じ。
- ペインでの表し方: タブの `path` が**絶対**（`/…`、`~/…`、`C:/…`）なら一ファイル表示。ペインの根に対する
  相対パスは今までどおり相対。`browseQuery(cwd, path)` が絶対パスを「そのディレクトリと名前」に分けて渡す
  ので、読み・書き・版・backup・Preview・raw・Preview のタブのすべてが一か所の規則で正しい基点を取る。
- 一ファイル表示で出さないもの: 履歴（History）と変更（Changes）はペインの根の git のものなので出さない。
  最近開いたファイル（ペインのフォルダごとの一覧）には記録しない。Canvas は物語の根の下にないので開けない。
  ツリーの追従（開いたファイルの行を見せる）はしない。Preview の中のリンクは、ペインのフォルダの外を指すので
  従来の「このフォルダの外を指しています」の通知を出して開かない（一ファイルの範囲を越えない）。
- ヘッダの名前の前に「外のファイル」の印（アイコン）を置き、説明文に絶対パスを出す。タブの説明文は
  もともと `path` 全体なので、絶対パスがそのまま出る。

## 仕組み

- `src/components/filesOutsidePath.ts`（新規、純粋）: `isOutsidePath(path)`、`outsideFileTarget(path)`
  （ディレクトリと名前。`/a.md` は `/`、`C:/a.md` は `C:/`、`~/a.md` は `~`）。
- `src/components/filesPaneApi.ts`: `browseQuery` が絶対パスをそのディレクトリと名前で渡す。
- `src/composables/canvasOpenFile.ts`: `absoluteUnder` は絶対パスをそのまま返す（Open in OS、Canvas の判定）。
- `src/composables/filesPaneOpener.ts`: `tryOpenInPane` が外のパスを `rebaseOutsideCwd` で絶対パスに
  組み直し、`grantKind` が null の種類だけペインに渡す。
- `src/composables/useFilesReveal.ts`: 前面のタブへのツリーの追従を、絶対パスでは行わない。
- `src/components/FilesPane.vue`: `outsideFile` 算出値。履歴・変更の部品に渡す `openPath` を外のとき null に。
  Recent に渡す `openPath` も同じ。ヘッダに印。Preview のリンクは外の文書では開かない。
- `src/i18n/tips/*.ts`: `tips.panes.outsideFile`（五言語）。

## 試験

- `filesOutsidePath.spec.ts`: 絶対の判定（`/`、`~/`、`C:/`、相対は false、`~x` は false）、分割。
- `filesPaneApi.spec.ts`: `browseQuery` が絶対パスをそのディレクトリと名前で渡し、ペインの根を無視する。
- `canvasOpenFile.spec.ts`: `absoluteUnder` が絶対パスを素通しする。
- `filesPaneOpener.spec.ts`: 外の `.md`（絶対、`../`、`~/`、Windows）は組み直した絶対パスで opener へ、
  外の画像・ページは false（タブのまま）。
- `filesPaneOutsideFile.spec.ts`（ペイン）: `/proj` に根付いたペインに `/elsewhere/report.md` を開くと、
  `text` はそのディレクトリを基点に読まれ、一覧は `/proj` だけ、ヘッダに名前と印、Preview の枠と Preview の
  タブの URL もそのディレクトリ、保存はそのディレクトリへ `baseVersion` 付きで書き、409 は衝突として
  出る。履歴は出ない。最近開いたファイルに記録しない。Preview のリンクは開かない。スナップショットに残り、
  復元で開き直す。
- 実機: 使い捨ての HOME で `ws/`（セル）と `other/report.md` を用意し、セルが `../other/report.md` を印字、
  クリックでペインに一ファイルで開くこと、ツリーが `ws` のままなこと、編集して保存するとディスクが変わること、
  ディスク側を外から書き換えてから保存すると衝突が出ることを確かめる。

## 文書

- `docs/file-surfaces.md`: 表の行と節。
- README「Clicking a file path」の「A path outside…」の段落。
- `docs/guide/{en,ja}/features.md` のファイルパスのリンク化の行、ペインの節。
- `docs/terminal-notes.md` のローカルパスの行。
