# fix #1962 — codex の resume 一覧が全部「Codex session」になり、`/rename` も反映されない

## 症状

MulmoTerminal のランチャーで Codex を選ぶと、resume 候補の行がすべて `Codex session` になる。
Codex 内で `/rename <name>` しても一覧に反映されない。

## 原因は 2 つ、互いに独立している

### A. タイトルの読み取り先が、codex がもう書かない record 型を見ている

`server/agents/codex-sessions.ts` の `isUserMessage` は

    type: "event_msg" / payload.type: "user_message"

だけを候補にする。codex はユーザーターンを

    type: "response_item" / payload.type: "message" / role: "user"

に移した。移行時期は 2026-08 中。**このマシンの実測**（`~/.codex/sessions`, 6,323 rollout）:

| 月 | rollout 数 | 旧形式を含む | 含まない |
| --- | --- | --- | --- |
| 2026-09 | 160 | 0 | 160 |
| 2026-08 | 2,840 | 899 | 1,941 |

そして本リポジトリの `listCodexSessions()` をそのまま実行すると:

    cwd=/Users/isamu/tne/orion5 → 15 行中 15 行が "Codex session"

（同じ関数を 7 月の rollout しかない cwd に向けると 15/15 でタイトルが出る。record 型の差以外に違いはない。）

新形式には**合成の前置きメッセージ**がある。`role: "user"` の 1 メッセージが複数の
content part を持ち、`<recommended_plugins>` / `<environment_context>` /
`# AGENTS.md instructions for <path>` が同居する。実プロンプトはその**次**の、単一 part の
メッセージ。したがって「最初の user メッセージ」を素直に取ると前置きを拾う。

### B. `/rename` は rollout ではなく別ファイルに書かれる。こちらは読んでいない

codex 本体の `codex-rs/rollout/src/session_index.rs`（openai/codex）より:

- 置き場所: `$CODEX_HOME/session_index.jsonl`
- 1 行 = `{ "id", "thread_name", "updated_at" }`、**append-only**
- 解決規則: `find_thread_names_by_ids` は前方走査で後勝ち、`thread_name` が空/空白の行は無視。
  → **同一 id の最後の非空エントリが現在の名前**
- 名前の削除は行の物理削除（`remove_thread_name_entries` が書き直して rename）。
  つまりこのファイルは「追記のみ」ではなく、**まれに縮む**。

MulmoTerminal はこのファイルを一度も開いていない。

## 修正

タイトルの優先順位（issue の提案どおり）:

1. `session_index.jsonl` の当該 id の最後の非空 `thread_name`
2. 新形式 `response_item/message` (role user) の最初の実プロンプト
3. 旧形式 `event_msg/user_message`
4. `Codex session`

2 と 3 は同じ 1 本のスキャンで扱う。record を順に見て「user ターンのテキスト part 群」を取り、
**part のどれかが codex 既知のラッパータグで始まるメッセージは、メッセージごと捨てる**。
残った最初のテキストがタイトル。

判定を **part 単位ではなくメッセージ単位**にするのは、AGENTS.md part 自身がタグを持たないから
（part 単位だと AGENTS.md を持つリポジトリの全セッションのタイトルがそれになる）。

タグを **既知の 4 つに限定**するのは #2009 のレビュー指摘（Codex / CodeRabbit の両方）による。
当初は「`<` + タグで始まるものはすべて合成」としていたが、それだと `<div>…` や `<task>…` で始まる
**本物のプロンプト**まで落ちる。ストア全体（6,325 rollout）の user メッセージに現れる先頭タグを数えると
4 種類しか無く、codex 自身が記録した実プロンプト 6,330 件のうち `<` で始まるものは 0 件:

| タグ | 出現 |
| --- | --- |
| `<environment_context>` | 6,315 |
| `<recommended_plugins>` | 4,521 |
| `<user_action>` | 14 |
| `<turn_aborted>` | 8 |

codex が 5 つ目のラッパーを足した場合の代償は「タイトルが目に見えて変」であって
「セッションが一覧から消える」ではない。かつ前置きは常に束で来る（`<environment_context>` は
6,315/6,330 に存在）ので、束に足された新ラッパーは既知タグ側で拾える。

### 2 の抽出規則は codex 自身の答えと突き合わせて検証した

このマシンの codex 0.149.0 は `~/.codex/state_5.sqlite` の `threads.first_user_message` に
「codex 自身が考える最初のユーザーメッセージ」を持っている。これを ground truth として
全 rollout で差分を取った（当初の広い規則で 6,322/6,325、既知タグに狭めた後で 6,327/6,330 —
狭めても一致は落ちていない）:

    agree=6,327  disagree=3

disagree の 3 件は `first_user_message` が空で、こちらは実プロンプト（"456" / "hello" / "はろー"）を
返しているもの。こちらの方が正しい側なので、規則の反例ではない。

### 1 の読み方

`session_index.jsonl` は「まれに縮む」ので差分 fold ではなく、**(size, mtimeMs) が変わったときだけ
全体を stream し直して Map を作り直す**。`forEachJsonlRecord` を使うのでファイルが何 MB あっても
メモリは一定、変化が無ければ 1 回の `stat` で終わる（この一覧は polling される）。

`$CODEX_HOME` は `codexSessionsRoot()` が `join(home, "sessions")` で作る唯一の場所なので、
一覧側は `path.dirname(root)` で home に戻す。この関係は spec で固定する。

## この PR に入れないもの

同じ record 型変更で**別の機能**も壊れている（実測済み、最近の rollout に
`event_msg/user_message` は 1 件も無い）:

- `server/session/prompt-history.ts` — codex セルの過去プロンプト（↑ 履歴）
- `server/session/last-turn.ts` — 直前ターンのプロンプト表示

同じ根っこだが機能も不変条件も別で、単独で revert できる。別 issue / 別 PR にする。
（`task_started` / `task_complete` は現行 rollout にも残っているので、
`codex-activity.ts` 側のターン境界は壊れていない。）
