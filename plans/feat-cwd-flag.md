# feat: --cwd flag (relative paths, default = current directory) (#36)

## ゴール

`npx mulmoterminal` で作業ディレクトリを指定できるようにする。

## 変更（bin/mulmoterminal.js のみ）

- `--cwd <dir>` フラグを追加。`resolveCwd(args)` が作業ディレクトリを解決:
  - 優先順位: **`--cwd`（相対パス可）> `CLAUDE_CWD` env > 実行時の現在ディレクトリ**。
  - すべて `path.resolve(process.cwd(), …)` で絶対パス化（相対 `--cwd ./x` 対応）。
  - 明示 `--cwd` が存在しないディレクトリならエラー終了（タイポ検出）。
- 解決した値を `CLAUDE_CWD` 環境変数として server spawn に渡す（server 側は変更なし。
  直接起動時のフォールバックは従来どおり `~/mulmoclaude`）。
- 起動時に `Workspace: <abs>` を表示。`--help` に `--cwd` を追記。

## 挙動変更

`npx mulmoterminal` のデフォルト cwd が `~/mulmoclaude` → **実行したディレクトリ**になる
（`CLAUDE_CWD` env を設定していればそれを優先）。

## 検証（ローカル実機・/api/sessions の cwd で確認）

- `--cwd /abs` → `/abs`。
- `--cwd` なしで dir X から実行 → `X`（process.cwd()）。
- 相対 `--cwd proj`（/tmp/foo から）→ `/tmp/foo/proj`。
- `--cwd /nonexistent` → `--cwd is not a directory` でエラー終了。
- `--help` に `--cwd` 表示、`lint`/`format:check`/`typecheck`/`test`/`build` 緑。

## 備考

マージ後 0.1.3 として publish 予定。
