# feat: 作業ログ自動集約（クローン横断）＋ vision/マイルストーン（#351）

Issue: #351 / Branch: `feat/worklog-vision`

## User Prompt

グリッドで複数プロジェクト・同一リポの複数 clone/worktree を並行開発している。(1) dir ごとに情報が分断される、(2) 何をやったか忘れる、(3) 大きな課題（vision/マイルストーン）を私も LLM も忘れる。定期バッチで全 clone を横断してやったことをまとめ wiki にログ化したい。vision/マイルストーンは絶対に忘れないよう永続記録し、**Claude Code で作業するときにそれをしっかり参照させたい**。まずはこの方向で。スケジュール起動は mulmoclaude の仕組みが mulmoterminal にもあるなら使う。

## 概要

**一般ユーザーが使える組み込みフィーチャー**として実装する（特定環境への手置きではない）。既にある**共有スケジューラ**（`server/backends/scheduler.ts` = `@mulmoclaude/core/scheduler` + `@receptron/task-scheduler`）と **wiki**（`<CLAUDE_CWD>/data/wiki/`）の上に、feed-refresh と同じ流儀で **組み込みシステムタスク＋埋め込みプロンプト**を追加する。ユーザーは**設定フラグで opt-in するだけ**（tasks.json を手書きしない）。バッチ本体（spawn される Claude セッション）が wiki ページや状態ファイルを**自動で用意**する。

### 一般ユーザー向け設計の要点
- **opt-in の設定フラグ**（既定 OFF。token コストがかかるため全員 ON にはしない）: `worklog.enabled`（＋任意で `worklog.intervalHours`、既定 6）。`AppConfig`/`config-schema` に追加、`POST /api/config` で設定（既存の config 系に載る）。将来は Settings トグルや `mulmoterminal-config` スキルからも。
- **埋め込みプロンプト**: 集計ロジック（下記データフロー）はコード内の定数プロンプトとして持つ。ユーザーは複雑な prompt を書かなくてよい。
- **自己スキャフォールド**: 初回実行時、バッチが `vision.md`/`milestones.md`/`worklog-state.json` が無ければ作る。手作業のセットアップ不要。
- **ゼロ設定の既定挙動**: 対象 dir は `cwdPresets`（そのユーザーが実際に開いた working dir）なので、環境に依存せずそのユーザーの作業が対象になる。

## 確定した設計判断

1. **頻度**: 6時間ごと。`{"type":"interval","intervalMs":21600000}`（UTC基準 → JST 9/15/21/3時）。
2. **ログ形式**: **週次でまとめる**。ISO 週ごとのページ `dev-log-YYYY-Www.md`（例 `dev-log-2026-W29.md`）に、6時間バッチが `## YYYY-MM-DD HH:MM JST` セクションを新しい順で追記。週が変われば新ページ。
3. **対象 dir**: **保存済み working dir = `~/.mulmoterminal/config.json` の `cwdPresets`**（terminal を開くと保存される dir 群）。全 clone を含む（実際に `mulmoclaude`×4, `mulmoterminal`×3 等が登録済み）。
4. **vision/マイルストーン**: 初期は**空**。会話で大きな課題が出てきた時に要約として追記していく運用。
5. **集計 window は固定6時間ではなく「前回実行以降」**: バッチは6時間ごとに起動するが、サーバ停止・スリープ・実行漏れで**実間隔が6時間を超えることがある**（後述のとおり user タスクは catch-up されない）。そのため window = **[前回実行時刻, 今]** とし、6時間を超える分も取りこぼさない。前回実行時刻は状態ファイルで管理（下記）。

## データフロー（クローン横断マージ）

各 dir の作業は `~/.claude/projects/<encoded-path>/*.jsonl`（transcript）に dir 別で残る。バッチ（spawn された Claude セッション、`CLAUDE_CWD=~/mulmoclaude` で走る）が:

1. **window を決める**: `config/scheduler/worklog-state.json` の `lastRunAt` を読む。無ければ初回とみなし既定（直近24時間）にフォールバック。window = **[lastRunAt, 今]**（固定6時間ではない）。
2. `~/.mulmoterminal/config.json` の `cwdPresets` を読み、対象 dir 群を得る。
3. 各 dir について、**window 内**に更新された transcript（`~/.claude/projects/` 配下、mtime が lastRunAt 以降）と `git -C <dir> log --since=<lastRunAt>` を収集。
4. **リポジトリ単位でマージ**: git remote（または clone サフィックスを除いた名前）でグループ化し、`mulmoterminal`+`mulmoterminal2`+`mulmoterminal3` を1つに、`mulmoclaude`×4 を1つに。→ dir 分断を解消。
5. グループごとに「やったこと／主要な変更・決定・未完・次の一手」を要約。
6. `vision.md`・`milestones.md` を読み、各マイルストーンの進捗を照合（進んでいないものを明示＝忘却検知）。
7. 当該 ISO 週の `dev-log-YYYY-Www.md` 先頭にセクション追記。secret/token は書かない。
8. **成功したら** `worklog-state.json` の `lastRunAt` を「今」に更新（失敗時は更新しない＝次回に取りこぼしを持ち越す）。書き出す期間の見出しにも window（from–to）を明記。

## 成果物（mulmoterminal リポのコード）

### 設定
- `server/config-schema.ts`: `worklog` 設定を追加（`{ enabled: boolean; intervalHours?: number }`、既定 disabled）＋ sanitizer。
- `server/app-config.ts`: `AppConfig`/`emptyConfig`/`loadAppConfig`/`saveAppConfig`/`mergeConfigUpdate` に `worklog` を通す。
- `server/config-routes.ts`: `getWorklogConfig()` アクセサ、`POST /api/config` で受理（既に汎用マージ）。

### バッチ本体
- `server/backends/worklog.ts`（新規）: 
  - `WORKLOG_PROMPT`（埋め込み定数。下記データフロー/prompt をコード化）。
  - `worklogSystemTask(deps): TaskDefinition` — interval（`intervalHours`、既定6h）で `spawnChat(WORKLOG_PROMPT)` を run にバインド。
- `server/index.ts`: `worklog.enabled` の時、`initUserTaskScheduler` の `systemTasks` に `worklogSystemTask` を追加（feed-refresh と並べて登録）。

### 自己スキャフォールド（コードで置かない、バッチが作る）
- `data/wiki/pages/vision.md` / `milestones.md` / `worklog-state.json` / 週次 `dev-log-YYYY-Www.md` は、バッチ（プロンプト）が無ければ作成する。リポにもワークスペースにも雛形を置かない。

### セッション参照（案A: 軽量版）
- 対象リポの `CLAUDE.md` / `AGENTS.md` に規約を1行:「作業開始時に `<workspace>/data/wiki/pages/vision.md` と `milestones.md` を読み、当セッションの目的をそれに沿わせる」。これはユーザーが自リポに入れる運用（本フィーチャーの必須依存ではない）。

### ドキュメント
- `README.md` に「作業ログ（worklog）」節: 何をするか、`worklog.enabled` での有効化、コスト注意、wiki 出力先。

### 案B（後日・別 issue 候補）
- mulmoterminal がセッション spawn 時に vision/マイルストーン要点（or ポインタ）を注入するコード。案A の効果を見てから。

## タスク定義（組み込みシステムタスク）

ユーザーが tasks.json を書くのではなく、`worklog.enabled` の時にコードが登録する（`worklogSystemTask`）。schedule = `{ type: "interval", intervalMs: worklog.intervalHours*3600_000 }`（既定 6h）。run = `spawnScheduledChat(WORKLOG_PROMPT)`。`WORKLOG_PROMPT` は `server/backends/worklog.ts` の定数。

`WORKLOG_PROMPT`（要点。コード内定数として整形）:
1. `date` で現在(JST)確認。`config/scheduler/worklog-state.json` の `lastRunAt` を読み、window = **[lastRunAt, 今]**。無ければ既定=直近24時間。**固定6時間にしない**（実間隔が6hを超える場合があるため）。
2. `~/.mulmoterminal/config.json` の `cwdPresets` を読み対象 dir 群を得る。
3. 各 dir の `~/.claude/projects/` transcript（mtime が `lastRunAt` 以降）と `git -C <dir> log --since=<lastRunAt> --oneline` を収集。
4. git remote/リポ名でグループ化し**clone をまたいでマージ**。
5. グループごとに やったこと/主要変更・決定/未完 を3〜6行要約。
6. `data/wiki/pages/vision.md`・`milestones.md` を読み進捗照合（未進行を明示）。
7. 当該 ISO 週 `dev-log-YYYY-Www.md` 先頭に `## YYYY-MM-DD HH:MM JST（window: <from>–<to>）` を追記（既存は消さない、`[[milestones]]` 等リンク）。secret は書かない。
8. 書き出し成功後に `worklog-state.json` の `lastRunAt` を「今」へ更新（失敗時は据え置き＝次回持ち越し）。

## vision / マイルストーンの運用

- 初期は空の雛形。会話で大きな課題が出た時に、その要約を `vision.md`（なぜ/最終形）と `milestones.md`（達成条件つきチェックリスト）に追記。
- バッチは**自動上書きしない**（読むだけ＋進捗を dev-log 側に書く）。編集は人／会話起点。

## 制約 / 注意

- **user タスクは catch-up されない**（`scheduler.ts`: "fire forward on schedule, with no ... catch-up"）。サーバ停止・スリープ・実行漏れで発火が飛ぶ → だから固定6時間でなく `lastRunAt` 基準の window が必須（取りこぼし防止）。
- `tasks.json` は**起動時読み込み**（CRUD/live reload 未実装）→ 追加後は**サーバ再起動**が必要。
- 横断要約は **token コスト**（cost 表示で監視）。長時間ダウン後は window が広がり一度のコストが増える（取りこぼさない代償）。
- 対象ワークスペースは `CLAUDE_CWD`（既定 `~/mulmoclaude`）。dev インスタンスが別 `--cwd` ならそちら。
- **多重発火**: 同じ `CLAUDE_CWD` で複数インスタンスを動かすとタスクが二重に発火し、ログ重複・`worklog-state.json` の競合が起きうる。スケジューラは1つの hub インスタンスで動かす（or 将来 dedup）。
- ISO 週番号・JST 変換は prompt 内で `date` を使って算出（モデルの推測に頼らない）。

## テスト / 検証

- **ユニット（純関数）**: `sanitizeWorklogConfig`（enabled/intervalHours の正規化・境界）、`worklogSystemTask` が正しい interval の `TaskDefinition` を返すこと（enabled=false なら未登録）、`mergeConfigUpdate` が `worklog` を保持すること。プロンプトビルダーがあれば入出力を固定テスト。
- **結合/ライブ**: `worklog.enabled=true` で起動→スケジューラに worklog システムタスクが載る（ログ確認）。手動で同等プロンプトを1セッション実行→ `dev-log-YYYY-Www.md` 生成、複数 clone がリポ単位でマージ、マイルストーン照合、`worklog-state.json` 更新を目視。
- token/コストを cost 表示で確認し、頻度・対象範囲を調整。
- ゲート: format / lint / typecheck / build / test。

## 対象外（別途）
- scheduler の CRUD/UI（現状 tasks.json 直編集）。
- 案B（セッションへのコード注入）。
- vision/マイルストーンのフル UI。
