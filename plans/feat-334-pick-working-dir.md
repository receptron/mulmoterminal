# feat #334 — Working directory を OS フォルダ選択で指定

New terminal ランチャーの Working directory 入力に、OS ネイティブのフォルダ選択
ダイアログを開く 📁 ボタンを足す。

## 問題

ランチャーの Working directory はテキスト入力＋プリセットのみ。深いパスを手打ちするより
OS のフォルダダイアログで選べたほうが速い。ヘッダーの 📎（`pickFile`）はファイル用で、
フォルダを選べない。

## 設計

### サーバ — `server/pick-file.ts`
- `pickFileCommand(platform, directory = false)` に directory 分岐を追加：
  - macOS: `osascript` `choose folder`（単一）。
  - Windows: `System.Windows.Forms.FolderBrowserDialog`。
  - Linux: `zenity --file-selection --directory`。
- `POST /api/pick-file` が body `{ directory: true }` を読んでフォルダモードに（既定＝ファイル、不変）。
- `parsePickerOutput` は共通（絶対パスのみ）。

### クライアント — `src/components/TerminalCell.vue`
- `pickDir()`：`POST /api/pick-file {directory:true}` → 最初のパスを `fillDir()` に渡す
  （入力反映＋resume/scripts/worktrees 更新）。
- `.cell-dir-row` に 📁 ボタン（`cell-dir-pick`、▶ の左）。既存の launch ボタンは `cell-dir-go`
  のままなので既存テストのセレクタは不変。CSS は `.cell-dir-go, .cell-dir-pick` で共有。

## ファイル
- `server/pick-file.ts` / `server/pick-file.spec.ts`（directory コマンド）
- `src/components/TerminalCell.vue` / `TerminalCell.spec.ts`（📁 ボタン → 入力反映）
- `README.md`（ランチャーのフォルダ選択）

## 非スコープ
- 実行中セルの cwd 変更（ランチャーのみ）。
- 複数フォルダ選択（cwd は単一）。
