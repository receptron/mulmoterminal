# Plan: ブラウザ端末へのファイルD&Dで絶対パス挿入

Issue: #75
作成日: 2026-06-21

ネイティブ端末（Terminal.app / iTerm）でファイルをD&Dすると絶対パスが挿入されるのと
同じことを、ブラウザの xterm.js 端末でも実現する。

---

## 背景・調査

- 入力経路は `Terminal.vue` の `term.onData → ws.send({type:"input", data}) → pty.write`。
  パス文字列を input として送れば挿入できる。
- ブラウザはセキュリティ上、ドロップ `File` の絶対パスを渡さない（`File.name` のみ。
  `File.path` は Electron 専用）。
- 絶対パスは `dataTransfer.getData("text/uri-list")`（無ければ `text/plain`）の
  `file://` URI から取得できる**場合がある**。Firefox / Safari は公開、Chrome は
  公開しないことが多い（= ブラウザ依存）。

## 方針（確定）

1. **file:// のみ**: `file://` URI を解析して絶対パスを取り出して挿入。ファイル内容の
   アップロードや一時コピーはしない。
2. **挿入のみ・Enter なし**: パスをそのまま input として送る。送信はユーザーに委ねる。
3. **複数ファイル**: スペース区切り。スペース等を含むパスはシェルクォート（単一引用符）。
4. `file://` が取れないブラウザでは何も挿入しない（誤った文字列を入れない）。
5. 単一表示・グリッド両方の `Terminal.vue` で有効。

## 実装

### 純粋関数（テスト可能） — `src/components/dropPaths.ts`
- `parseFileUris(uriList: string): string[]`
  - 改行区切り、`#` コメント行と空行を無視、各行を `file://` URI として絶対パスへ。
  - `new URL()` で解析、`decodeURIComponent(pathname)`、Windows `/C:/...` は先頭スラッシュ除去。
  - `file://` 以外・解析不能はスキップ。
- `toShellArg(path: string): string`
  - 安全な文字のみならそのまま、それ以外は単一引用符で囲み `'` をエスケープ。
- `dropTextFromUriList(uriList: string): string`
  - 上記2つを合成してスペース区切りの挿入文字列を返す（空なら空文字）。

### Terminal.vue
- `.terminal-container` に `@dragover.prevent` と `@drop` を付与。
- `onDrop`: `dataTransfer.files.length === 0` なら無視（ファイル以外のドラッグを誤挿入しない）。
  `text/uri-list`（無ければ `text/plain`）から `dropTextFromUriList` で文字列化し、空でなければ
  既存の input チャンネルで送信。`term.focus()`。
- ドラッグ中の軽いハイライト（`dragOver` ref）。

### テスト — `src/components/dropPaths.spec.ts`（vitest）
- 単一/複数 file:// URI、`%20`（スペース）デコード、`#` コメント・空行無視、
  非 file:// 行スキップ、Windows ドライブパス、単一引用符エスケープ、空入力。

## 追加: file アイコン（全ブラウザ向け・サーバ側ネイティブダイアログ）

D&D の `file://` は Firefox/Safari でしか取れない。Chrome を含む全ブラウザで実パスを
得るため、**ローカルサーバが OS のファイル選択ダイアログを開いて絶対パスを返す**経路を
追加する（`<input type=file>`/`webkitdirectory` はブラウザが絶対パスを伏せるため不可）。

### サーバ — `server/pick-file.ts`（`open-dir.ts` を踏襲）
- `pickFileCommand(platform)`: macOS `osascript`（`choose file ... multiple`）/
  Windows `powershell`（OpenFileDialog）/ その他 `zenity`。固定コマンド＋固定 argv
  （プロンプトは定数）でシェル無し・入力補間なし。
- `parsePickerOutput(stdout)`: 改行分割・trim・絶対パスのみ。キャンセルは空 → `[]`。
- `mountPickFileRoute`: `POST /api/pick-file` → ダイアログを開き `{ paths: string[] }`。
  同一オリジンガードは他のローカル操作ルートと同じ。
- テスト `server/pick-file.spec.ts`（vitest, node 環境で実行）。

### Terminal.vue
- ヘッダに file アイコン（Material Symbols `attach_file`）。クリックで `/api/pick-file`
  を叩き、返った絶対パスを `toInsertText`（D&D と共通）で挿入。
- 挿入ロジックは `insertText()` に集約し D&D と共有。

## スコープ外
- ファイル内容のアップロード／サーバ一時保存方式（コピーのパスになるため）。

## 確認事項（手動）
- OSネイティブのドラッグは Playwright で再現困難。対象ブラウザ（Chrome/Safari/Firefox）で
  実際にドロップして挙動を確認する。
