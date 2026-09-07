# #1976 PR 2 — stories ルート外のデッキにも Canvas ボタンを出す

[PR 1](fix-1976-canonical-card-identity.md) で card identity を「ワイヤの綴り」から
「解決した絶対パス」に変えた。その前提でゲートを緩め、**issue はこの PR で閉じる**。

## 変えたこと

`src/composables/canvasOpenFile.ts` の `storyWirePath` は、登録済み stories ルートの配下に
無いファイルに `null` を返していた（＝ボタンが出ない）。これを、**そのファイル自身の絶対パス**を
返すように変える。プラグインは 4.6.0 から絶対 `filePath` を受け、このホストは `byPath` で
opt-in 済み（`server/backends/mulmoscript.ts`）なので、**開ける経路は最初から在った**。

ルート相対の綴り（`stories/<tail>` + root id）は**今までどおり先に決まる**。短くて読めるし、
カードが名乗る root が本当になる。絶対パスはその後の受け皿。

## なぜ今まで出していなかったか（issue 本文の判断）

identity がワイヤの綴りそのものだったから。同じデッキを root 経由と絶対パス経由で開くと
**カードが 2 枚**に割れ、しかも toolResults は永続する。PR 1 でどちらも同じ絶対パスに
解決されるようになったので、2 枚に割れる理由が消えた。

## 波及（このゲートを見ている場所すべて）

`canOpenInCanvas` は 3 か所から呼ばれる。**3 つとも**この変更の対象で、意図的:

- **Files ペインのヘッダの Canvas ボタン**（`FilesPane.vue`）
- **ファイルツリーの行メニュー Open in the Canvas**（`filesRowActions.ts`）
- **Mulmo メニュー**（`MulmoMenu.vue`）。デッキの一覧自体は root と無関係
  （`server/backends/deckList.ts` = ワークスペースの `artifacts/stories` + そのディレクトリの
  `.mulmoterminal.json` の `decks`）。出さない理由がクライアント側のゲートだけだったので、
  「起動時に登録されていないディレクトリでは宣言したデッキが開けない」制限もここで消える。

## 判断したこと

- **`.json` だけで判定する**。中身が本当に MulmoScript かはプラグインが決める
  （`File is not a valid MulmoScript` を返し、ペインがその文を出す）。ここで二重に判定しても
  弱い判定にしかならない。**これは surface をほとんど広げない**: ワークスペース配下の `.json` は
  すでに全部（`package.json` も）ゲートを通っていた。今回増えるのは「どの root の下にも無い」場所だけ。
- **相対パスは返さない**。ペインは cwd が無いとき行の相対パスをそのまま渡す（`absoluteUnder`）。
  相対 `filePath` は「向こうのあのファイル」ではなく、default root の同名ファイルを指す。
- **キーを取らず、ペインが綴ったままの絶対パスを渡す**。`dirPathKey` は trim するので、
  末尾が空白のファイル名が別のファイルになる。`expectPath` にも同じ文字列が載る。

## 検証

- ゲートを見ている 3 か所すべてに spec。既存の「ルート外は出さない」テストは**新しい規則に書き換え**
  （出るようになったこと自体が仕様変更なので、消さずに意味を反転させて残す）。
- 実サーバで、ルート外のデッキを reopen → カードが返ること、View から編集・保存できることを確認。
