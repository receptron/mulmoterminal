# fix: ストリーム/外部呼び出しのエラー・タイムアウト漏れ（#744）

## User Prompt

> mulmoclaude で全ファイルをレビューして…（略）バグを issue 化し、順に対応・CI・レビュー対応・マージまで進める

## 1. 生ファイル配信のストリームに error ハンドラが無い（`server/backends/files.ts`）

`GET /api/files/raw` は `createReadStream(abs).pipe(res)` を error ハンドラ無しで実行。
`statFileOr404` の statSync 後〜ストリーム open の間にファイルが消える／読めない（`chmod 000`）と、
未処理の 'error' → uncaughtException になり、レスポンスが返らないままハングする。
Range 分岐と全体配信の 2 箇所が該当。

## 2. HTML プレビューも同型（`server/backends/html.ts`）

`GET /artifacts/html/<rest>` の `createReadStream(abs).pipe(res)` も error ハンドラ無し。

## 3. Gemini 画像生成にタイムアウト／abort が無い（`server/backends/image-gen.ts`）

`generateContent` がストールすると呼び出し側が無期限に待ち、ツール呼び出しが "running" のまま残る。

## 修正

- `server/backends/streamFile.ts`（新規）に共有ヘルパを作成:
  - `streamErrorAction(headersSent)`（pure）: ヘッダ送信済みなら `"destroy"`、未送信なら `"500"`。
  - `streamFileToResponse(abs, res, range?)`: read stream に error ハンドラを付け、
    ヘッダ未送信なら 500、送信済みなら `res.destroy()`。files.ts（2箇所）と html.ts が使用。
- `image-gen.ts`: `AbortController` + `setTimeout`（120s）で abort。`GenerateContentConfig.abortSignal`
  に渡す（@google/genai 2.12.0 でサポート確認済み）。timeout 時はメッセージに「timed out」を明示。

## テスト

`test/server/backends/streamFile.spec.ts`（新規）:
- `streamErrorAction`: headersSent true→destroy / false→500。
- `streamFileToResponse`: 正常配信、存在しないファイルで 500（ENOENT 発火）、ヘッダ送信済みで destroy。
  分岐反転のミューテーションで 4 テストが赤になることを確認。

全 backend テスト 506 件 + typecheck / lint パス。
