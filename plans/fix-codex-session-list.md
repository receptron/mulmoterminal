# fix: Codex の resume 一覧が「全体上限 → cwd フィルタ」の順で壊れている（#1777）

## User Prompt

> https://github.com/receptron/mulmoterminal/issues/1777　調査して

> PRまですすめよう。

## 症状（実測。issue #1777 に全数値を記録済み）

`~/.codex` に 3059 ロールアウトある環境で、実 API を叩いた結果:

```
/Users/isamu/tne/orion4                       -> 15 sessions（15 行すべて "Codex session"）
/Users/isamu/tne/orion4/.claude/worktrees/…   ->  0 sessions（ディスクには 30 件ある）
/Users/isamu/ss/llm/mulmoterminal4            ->  0 sessions（対話セッションの cwd）
```

- 159 個の cwd のうち 200 件枠に入るのは **21 個だけ**。138 個（87%）が空リスト
- 対話セッション（`source: cli`）64 件は **1 件も枠内に入らない**

## 独立した 3 つの欠陥

### 1. 全体上限が cwd フィルタより先に来る（本体）

`listCodexSessions` は `recentRolloutPaths(root, SCAN_LIMIT=200)` で
**machine 全体の新しい 200 件**を取り、そのあとで `s.cwd === cwd` を掛ける。
codex の保存だけが日付分割（`~/.codex/sessions/YYYY/MM/DD/`）で、cwd はファイルを開くまで
分からないため、この順序になっている。

リポジトリ自身が既にこの差を書いている（`server/agents/grok-sessions.ts:172`）:

> `SCAN_LIMIT` bounds the filesystem work, and **unlike codex's window it costs nothing in
> accuracy** for a normal directory: the cap is on conversations in ONE working directory, not on
> every conversation on the machine.

| agent | 保存の分割 | 上限のかかり方 |
|---|---|---|
| claude | `~/.claude/projects/<encoded-cwd>/` | cwd 単位 |
| grok | `grokCwdDir(root, cwd)` | cwd 単位 |
| **codex** | **日付** | **全体。cwd フィルタはその後** |

枠を食う中身は環境で違う（報告者は subagent、こちらは `codex exec` が 2981/3059）が、
**同じ欠陥の別の現れ方**であり、片方だけ潰しても直らない。

### 2. `HEAD_BYTES = 64KB` がタイトルに届かない

`session_meta` だけで 7〜22KB あり、その後の preamble を挟むので
最初の `event_msg/user_message` は窓の外に出る:

| source | 件数 | `user_message` の位置 |
|---|---|---|
| `exec` | 2981 | 中央値 **75KB** — 抽出 60/60 が窓の外 |
| `cli` | 64 | 60 件中 8 件が窓の外 |
| `subagent` | 14 | 14/14 が窓の内 |

**issue の診断（subagent は `user_message` を持たない）とは別の原因**で、
`thread_source` で除外してもタイトルは直らない。

### 3. subagent / automation が一覧を埋める

subagent ロールアウトは**親の cwd を持つ**（実測 14/14）ので、cwd 一致してしまう。

## 直し方

`listCodexSessions` の順序を **「cwd フィルタ → 件数上限」** に入れ替える。

1. **cwd の判定は 1 行目だけ読む。** `session_meta` は必ず 1 行目なので、タイトル用の大きな窓は
   要らない。パス単位でメモ化する — **ロールアウトの 1 行目は作成時に一度書かれるだけで、
   以降の追記で変わらない**ため、キャッシュ無効化が要らない。
2. **`thread_source` の deny-list**（`subagent` / `automation`）で除外。allow-list にしないのは、
   `realtime_voice` のような未知の値を silent に消さないため。`thread_source` 自体が無い
   古い版が 333 件あり、これも残す必要がある。
3. **タイトルと mtime は cwd が一致したものだけ読む。** 一致分を stat して mtime 順に並べ、
   上位 `limit` 件だけ `user_message` を探す。ここで窓を広げれば 2 が直り、
   1 行目読みにしたことで「`session_meta` が 64KB を超えると会話ごと消える」潜在バグも消える。

これで mtime 順の選択が本物になる（従来は「ファイル名順で 200 件選んでから mtime で並べ替え」
だったので、作成が古く最近まで使っていたセッションを取りこぼしていた。対話セッションは
作成から最大 7 時間、中央値 351 秒のあいだ追記される）。

## コスト（実測、Node / 並列 32）

| 操作 | 実測 |
|---|---|
| 全 3065 ファイルの 32KB 読み | **238 ms**（メモ化後は新規ファイルのみ） |
| 現行（64KB × 200） | 23 ms |
| 一致分 50 件のタイトル取得 | **7 ms** |

初回 238ms、2 回目以降はほぼ 0。cwd 単位に分割されていない保存に対する代償として妥当と判断する。

## 検証

- 実 API で修正前後を比較し、報告された 3 ケースが直ることを確認する
- 純関数（1 行目のパース、deny-list 判定）は `test/` で両方向に網羅する
- 実データ 3059 件に対して修正前後の出力を突き合わせ、
  **減った行・増えた行の内訳が説明できること**を確認する
