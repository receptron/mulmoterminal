# refactor: server/ 直下のフラット .ts をディレクトリ整理（#372）

Issue: #372 / Branch: `refactor/server-dir-layout`

## User Prompt

server 以下に ts ファイルがまとまっている。tools とか、config とか、llm(codex, claude) とかで dir 分けて整理したほうが良くない？

## 決定（対話で確定）

- LLM 系（`claude-args` / `codex-*`）は既存 `agents/`（`claude.ts` / `codex.ts` adapter）に**集約**。
- 進め方は **1つの refactor PR で一括**。`git mv` で履歴保持、**挙動不変**（純粋な移動＋import パス更新）。

## レイアウト

`server/` 直下 47 ファイル（index.ts を除く 46）を役割別サブディレクトリへ:

- `agents/` … claude/codex adapter（既存）＋ `claude-args` `codex-args` `codex-session(s)` `codex-skills`
- `config/` … `app-config` `config-routes` `config-schema` `dir-config` `cwd-presets` `header-config` `header-context` `header-resolve` `header-title`
- `session/` … `session-resolve` `transcript` `terminal-replay` `activity-hook` `activity-state` `cost` `command-summary` `file-cache`
- `git/` … `git-status` `gitRemote` `gh` `issues` `prs` `pr-for-branch` `worktrees` `worktree-diff` `worktree-pr` `worktree-routes`
- `files/` … `files-browse` `pick-file` `open-dir` `scripts`
- `infra/` … `pubsub` `spa-fallback` `tmux` `tmux-routes` `sandbox` `host-tools` `plugins-registry` `web-push` `install-config-skill` `accounting-tool`
- 据え置き: `index.ts` / `fix-pty-perms.js`、既存 `backends/` `mcp/` `skills/`

各ソースの `*.spec.ts` はソースと同じディレクトリへ一緒に移動（相対 import の相手が同居するので spec 側の import はそのまま）。

## 実施方法

このリポは**相対 import 固定（エイリアス禁止）**なので、移動＝全 import パス更新が必要。手作業は事故りやすいので **codemod で機械的に一括書き換え**:

1. old→new のファイルマップを作り、`server/` 配下の全 `.ts` の相対 import 指定子を新レイアウトに沿って再計算（`.js` 有無・extensionless spec も保持）。
2. `git mv` で 86 ファイル（source + spec）を移動（履歴保持）。
3. `yarn typecheck:server` / `yarn build` / `yarn test` を安全網に挙動不変を検証。

結果: import 書き換え 59 箇所 / 16 ファイル、移動 86 ファイル。typecheck:server クリーン、build OK、test 1143 パス。

## 対象外（別途）

- `index.ts`（2776 行）の分割（ルートハンドラ抽出）は“移動”より踏み込む変更なので本 PR に含めない。
