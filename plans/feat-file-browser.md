# feat: 端末ヘッダーに 📁 Files ブラウザ

Issue: #116

## ゴール
各端末ヘッダーに **📁 Files** ボタン（diff/Run と同型）。開いているプロジェクト(`serverCwd`)配下を一覧し、ファイルクリックで種類別に**ブラウザ新規タブ**で開く（参照のみ）。

- 画像 → そのまま表示 / md → レンダリング / text・コード → text/plain
- エディタ起動は今回なし。cwd 未確定ならボタン非表示。

## サーバ
新規 `server/files-browse.ts` — `mountFilesBrowseRoutes(app, { defaultCwd })`。
- 純粋関数（テスト対象）:
  - `resolveBase(cwd, defaultCwd)` — 絶対・実在 dir ならそれ、さもなくば defaultCwd（`resolveWorkspace` と同等）。
  - `containedPath(base, rel)` — `path.resolve(base, rel)` が base 配下なら abs、外なら null。
  - `mdToHtmlDoc(html, title)` — `marked` 出力を最小 HTML ドキュメントに包む。
- エンドポイント:
  - `GET /api/files/browse/list?cwd=&path=` → `{ cwd, path, entries: [{ name, dir, size }] }`（dir 優先・名前順）。
  - `GET /api/files/browse/raw?cwd=&path=` → バイト配信（files.ts の `sendRawFile` を再利用、MIME＋nosniff＋sandbox CSP＋Range）。
  - `GET /api/files/browse/md?cwd=&path=` → `marked` で HTML 化し sandbox CSP で配信。

`server/backends/files.ts` を小リファクタ: `MIME_BY_EXT` と封じ込め後の配信処理を `sendRawFile(req,res,abs)` として export し、既存 `/api/files/raw` と browse/raw で共用（DRY）。

## フロント
新規 `src/components/FileBrowser.vue`（RunMenu と同型の自己完結ドロップダウン）。
- props `cwd`。cwd 未解決ならボタン非表示。
- 📁 ボタン＋パネル（パンくず＋Up＋一覧）。フォルダはパネル内ナビ、ファイルは拡張子で判定し `window.open`:
  - `.md`/`.markdown` → `/api/files/browse/md?...`
  - それ以外 → `/api/files/browse/raw?...`
- 外側クリック / Esc で閉じる。cwd 変化で閉じてリセット（RunMenu と同様）。

`Terminal.vue` ヘッダーに `<FileBrowser :cwd="serverCwd" />` を設置（RunMenu の隣）。単一ビュー＋グリッド各セル両方に出る。

## テスト
- `files-browse.spec.ts`（サーバ純粋関数: resolveBase / containedPath / mdToHtmlDoc）。
- `FileBrowser.spec.ts`（fetch モック: 一覧表示・フォルダナビ・cwd null で非表示・cwd 変化で閉じる）。

## ドキュメント
README に「📁 Files」節と `/api/files/browse/*` を追記。

## 確認ゲート
`yarn format` / `lint` / `typecheck` / `build` / `test`。UI実機（📁→一覧→フォルダ移動→画像/md/text を新規タブで開く・cwd 無しで非表示）は手元で目視確認。
