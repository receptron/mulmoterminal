# fix #2024 — 起動ディレクトリにアプリの実行時状態を書かない

## 問題

`npx mulmoterminal` の既定 workspace は起動ディレクトリ（`chooseCwd` が `--cwd` 未指定で `"."`）。
空のプロジェクトフォルダで起動するだけで、次の 3 つが作られる（実測）:

| パス | 書き手 | 中身 |
| --- | --- | --- |
| `<ws>/config/scheduler/state.json` | core の scheduler adapter | 実行状態（lastRunAt / totalRuns …） |
| `<ws>/data/scheduler/logs/` | 同上 | 実行ログ（毎時、空振りでも 1 行） |
| `<ws>/data/notifier/` | `initNotifier` | 通知の active / history |

どれも**ユーザーが書いたものではなくアプリの実行時状態**で、止める手段が無い。

このリポジトリは既に同じ不変条件を持っている（`workspaceSetup.ts:7-10` /
README:616 / `isManagedWorkspace()`）のに、scheduler と notifier だけがそれを通っていない。
`[workspace-setup] skipping seed — not the managed mulmoclaude workspace` を出した同じ起動が、
その直後に同じディレクトリへ書く。

## 直し方

**managed workspace のときだけ workspace 配下に置き、それ以外は `~/.mulmoterminal/` へ逃がす。**

```
managed (~/mulmoclaude)  → <ws>/config/scheduler/state.json      (今までどおり)
それ以外                  → ~/.mulmoterminal/workspaces/<key>/config/scheduler/state.json
```

`<key>` は workspace の絶対パスから作る per-workspace キー。**相対レイアウトは変えない**ので、
逃がす先に root を差し替えるだけで core も notifier engine も無変更で動く。

### なぜ managed のときは動かせないか

両方のファイルが理由をコメントで持っている。動かすと MulmoClaude と別のファイルを見ることになる。

- scheduler state: 「Both hosts read the same file for the same workspace」(`scheduler-state-seed.ts:35`)
- notifier: 「the same files MulmoClaude uses; both apps never run simultaneously」(`notifier.ts:2-4`)

参照ホストを確認済み: MulmoClaude の `workspacePath` は
`MULMOCLAUDE_WORKSPACE_PATH || ~/mulmoclaude`（`server/workspace/paths.ts:96`）で、
MulmoTerminal の `managedWorkspacePath()` と同じ式。つまり **managed のときは MulmoClaude と
完全に同じ挙動のまま**で、divergence はゼロ。managed でない起動ディレクトリに MulmoClaude は
そもそも居ないので、逃がして安全。

### core は無変更

`SchedulerConfig.workspaceRoot` は state.json と logs の置き場所にしか使われていない
（`dist/scheduler/index.js` の 274 / 277 行の 2 箇所のみ。`adapter.d.ts` の doc comment も
「state.json + logs hang off it」）。タスクが実際に refresh する root は `buildSystemTasks` が
別途渡しているので影響しない。

## 変更するもの

1. **`server/infra/workspace-key.ts`（新規・純粋関数）** — `workspaceKey(workspace)` が
   絶対パスから `<slug>-<sha256 の先頭 8 桁>` を返す。
   これは `scheduledSessionsDir()`（`server/session/scheduled-sessions.ts:93`）に既にある
   ロジックの抽出。Windows の `\` `:` 対策と衝突回避の理由も既存コメントごと持ってくる。
   - **抽出なので behaviour preservation の証明が要る**（`/refactor-safely`）。
     旧実装を throwaway harness に verbatim でコピーし、生成入力で全件比較して件数を PR に書く。
   - `scheduledSessionsDir` はこれを呼ぶように置き換え。出力は 1 バイトも変わらない。

2. **`server/infra/host-state-root.ts`（新規・純粋関数）** —
   `hostStateRoot(workspace, home?)`: managed なら `workspace` をそのまま、
   それ以外は `path.join(home, "workspaces", workspaceKey(workspace))`。
   `isManagedWorkspace()` を `workspaceSetup.ts` から使う。

3. **`server/backends/scheduler.ts`** — `initUserTaskScheduler` の中で 2 つに分ける。
   - `loadUserTasks(deps.workspace)` は**実 workspace のまま**（`tasks.json` はユーザーが書くファイル）
   - `configureSchedulerAdapter(...)` と `seedSchedulerState(...)` は `hostStateRoot(...)` を受け取る

4. **`server/backends/notifier.ts`** — `initNotifier` の `data/notifier` を `hostStateRoot(...)` の下へ。

5. **docs** — README の環境変数表（`CLAUDE_CWD` / `MULMOCLAUDE_WORKSPACE_PATH` の行）に、
   何が workspace に置かれ何が `~/.mulmoterminal` に逃げるかを 1 行ずつ。

## やらないこと

- **既存ファイルの移行はしない。** 旧 `<ws>/config/scheduler/state.json` は放置し、新しい場所を
  使う。理由: 我々が謝っている当のディレクトリを、直すために更に触りにいくのは筋が悪い。
  失われるのは bookkeeping だけ（lastRunAt / totalRuns）で、feed も calendar も
  due 判定は自分のマーカー（`lastFetchedAt` / `lastSyncedAt`）から再導出する。
  初回は first-run state が seed され、1 window ぶんスキップされるだけ。
  → 「消しても復活する」が「消せば消える」に変わるので、残骸は消せば済む。README に 1 行書く。
- **`config/scheduler/tasks.json` は動かさない。** ユーザーが書くファイルで workspace のもの。
- **system task の on/off 設定**は別 PR（#2015）。
- **worklog** が `config/scheduler/worklog-state.json` と `data/wiki/` に書く件は対象外。
  既定 off の opt-in 機能で、「何も設定していないのに増える」に該当しない。

## 検証

- **ground truth は実際の起動**。空ディレクトリ + scratch `HOME` でサーバを起動し、
  修正前に作られた 3 つが**作られないこと**、`~/.mulmoterminal/workspaces/<key>/` 側に
  出ることを実測する（build が通っただけでは動作の証明にならない）。
- managed workspace 側も動かす（`MULMOCLAUDE_WORKSPACE_PATH` を scratch に向けて、
  今までどおり workspace 配下に出ることを確認）。**条件を振る**のが要点で、
  片側だけ見ても gate が効いているとは言えない。
- `workspaceKey` 抽出の差分ハーネス（旧実装 verbatim vs 新、生成入力）。
- 既存 spec: `test/server/session/scheduled-sessions.spec.ts` が
  衝突 / 正規化 / Windows 文字 / 長さ上限を既に押さえている。抽出後の
  `workspaceKey` 自身の spec にも同じ性質を持たせる（generator と property の harvest）。
- 新規 spec: `hostStateRoot` が managed / 非 managed の両方向で正しい root を返すこと。
- `yarn format` → `yarn lint` → `yarn build` → `yarn typecheck` → `yarn test`。
