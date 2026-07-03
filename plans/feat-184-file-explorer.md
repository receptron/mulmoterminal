# feat-184: 全画面ファイルエクスプローラー＋Markdown編集ビュー

Issue: #184（Supersedes #116 / #117）

## 決定事項（ユーザー確認済み）
- エディタ: **CodeMirror 6**（`codemirror` + lang-markdown/javascript/json + theme-one-dark）。
- terminal→ファイル導線: **ヘッダの Files ボタン**（そのセルの cwd をルートに `/files` を開く）。
- md プレビュー: 既存の **sandboxed iframe**（`/api/files/browse/md`）を流用（`v-html` は使わない）。

## アーキテクチャ方針
旧 `feat/file-browser` の browse ロジック（`files-browse.ts`: `resolveBase` / `containedPath` / `mdToHtmlDoc` / `listEntries`）を **自己完結で main に取り込み**、書き込み API とテキスト読み取りを足す。全画面ビューは `/prs`（#183）と同じ overlay パターン。

## 変更ファイル

### サーバ
- `server/files-browse.ts`（新, 旧ブランチ流用）: `resolveBase` / `containedPath`（書き込みのパス封じ込めにも使用）/ `mdToHtmlDoc` / `listEntries`。
  - `GET /api/files/browse/list?cwd=&path=` — ディレクトリ一覧（dir 優先）。
  - `GET /api/files/browse/text?cwd=&path=` — テキスト内容 `{ text, truncated }`（サイズ上限・utf8）。
  - `GET /api/files/browse/md?cwd=&path=` — marked→HTML を sandbox CSP で（プレビュー iframe 用）。
  - `PUT /api/files/browse/write?cwd=&path=` — `{ text }` を封じ込めパスに書き込み（cwd 外禁止・サイズ上限）。
- `server/index.ts`: `mountFilesBrowseRoutes(app, { defaultCwd: CLAUDE_CWD })`。
- `server/files-browse.spec.ts`（新）: `containedPath` / `resolveBase` / list・write の封じ込め。

### クライアント
- `src/router/index.ts`: `/files` ルート（Stub）。
- `src/composables/useFilesView.ts`（新）: `useFilesView()`（isOpen=route.name==="files", close, targetCwd=route.query.cwd）＋ `filesGotoIndex(cwd)`。
- `src/components/FilesOverlay.vue`（新）: 左=階層ツリー（遅延展開）、右=CodeMirror エディタ＋保存、md は プレビュー(iframe)トグル。dirty 管理・保存・リロード・閉じる。
- `src/components/cmEditor.ts`（新）: CodeMirror 6 の生成/破棄/ドキュメント差し替え/言語 Compartment（拡張子→md/js/json）を薄くラップ（テスト可能な純ロジックは分離）。
- `src/components/Terminal.vue`（ヘッダ）: 📁 Files ボタン → `filesGotoIndex(serverCwd)`。
- `src/App.vue`: `<FilesOverlay />` をマウント。

### テスト
- `server/files-browse.spec.ts`: 封じ込め・write の cwd 外禁止。
- `src/components/cmEditor.spec.ts`: 拡張子→言語判定など純ロジック。
- `src/composables/useFilesView.spec.ts` or FilesOverlay 描画（ツリー/エディタ）。

## セキュリティ
書き込みは `containedPath` で cwd 外を 403。サイズ上限。プレビューは sandbox CSP の iframe（app オリジンで script 実行不可）。

## ゲート / 確認
typecheck(client/server)/format/lint/build/test。実サーバで list/text/write/md を e2e（封じ込め含む）。
