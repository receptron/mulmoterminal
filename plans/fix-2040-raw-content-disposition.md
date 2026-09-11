# #2040 — raw ルートが保存名を伝えていない

## 症状

ターミナルのパスリンクから PDF を開き、ビューアから保存すると `raw.pdf` になる。
元の名前（`2026-08-report.pdf` など）が失われる。

## 再現（実ブラウザで測定）

`Content-Disposition` が無いとき、ブラウザは URL の最後のパスセグメント（`raw`）に
Content-Type から決めた拡張子を足して保存名にする。**Safari 固有ではない**:

| ファイル | Chromium | WebKit（Safari と同エンジン）|
| --- | --- | --- |
| `2026-08-report.pdf` | `raw.pdf` | `raw.pdf` |
| `月次レポート 2026-08.pdf` | `raw.pdf` | `raw.pdf` |
| `weird";name.pdf` | `raw.pdf` | `raw.pdf` |

稼働中の 4.20.0 のヘッダも確認。200 も 206 も `Content-Disposition` を含まない。

## 直し方

`Accept-Ranges` の直後、**Range 分岐より前**に `Content-Disposition: inline; filename=…` を
設定する。1 箇所で 200 と 206 の両方に乗る（実測確認済み）。

- **`inline`**: タブ内で表示される今の挙動を変えないため。`res.attachment()` は
  `attachment` になるので使えない。
- **ヘッダの組み立ては `content-disposition` パッケージに任せる。** Express 自身が
  `res.attachment()` で使っているもので、ASCII フォールバック + `filename*=UTF-8''`
  （RFC 6266）、引用符のエスケープ、改行の除去まで込み。手で組むと issue が挙げていた
  難所を自前で踏むことになる。推移的依存として既に入っていたものを直接依存に昇格する。

## 名前は「要求された綴り」から採る（規則として切り出す）

`resolveContained` は **realpath する**（`server/files/pathContainment.ts:122`）ので、
symlink 経由だと `abs` の basename は**リンク先の名前**になる。ユーザーがクリックしたのは
リンクの名前なので、そちらを出すのが正しく、リンク先の名前を出すのは情報の漏れでもある。

この判断を `server/backends/servedFileName.ts` の純粋関数に切り出し、両方向で網羅的に
テストする（通常・日本語・引用符・改行・末尾スラッシュ・`.`/`..`・空・Windows 区切り・
symlink で綴りが食い違うケース）。

## 副作用が無いことの確認（実測）

このルートは画像・テキスト・動画も返す。`inline` を全体に付けて測定:

| 経路 | 結果 |
| --- | --- |
| `<img>`（wiki / コレクション画像）| 両エンジンで描画 OK |
| テキスト（`.md`）| 両エンジンでタブ内表示のまま（ダウンロードにならない）|
| 未知拡張子（`.bin`）| `raw` → `データ.bin` に改善 |

`rawServingPlan.ts` が意図している「テキストは VIEW させる／未知拡張子は octet-stream で
ダウンロード」を壊さない。**PDF に限定せず raw ルート全体に付ける。**

## 検証

- `servedFileName` の spec を、正常系と異常系（空・null 相当・区切りだけ・両区切り）で網羅。
- `files.spec.ts` に 200 / 206 / 日本語名 / 引用符入り / symlink の assertion を追加。
- 反転 mutation で赤くなることを確認する。
- `yarn format` → `lint` → `typecheck` → `build` → `test`。
- 依存を足したので **クリーン install で検証する**（`rm -rf node_modules && yarn install --frozen-lockfile`）。
