# fix: スケジュール実行が生成した tmux セッションを回収する (#541)

## 症状

スケジュール実行（worklog / `config/scheduler/tasks.json` のユーザタスク）が生成した tmux セッション
`mt-<uuid>` が終了後も残り続け、無限に蓄積する。実測で 76 セッション / claude プロセス 72 / 合計 RSS
41.8 GB、最古は 16 日放置。detached 66 個の削除で約 35 GB を解放した。

## 原因

リープ機構（`server/index.ts` の `reap()` → `tmuxKillSession`）は存在するが、スケジュール生成セッションは
3 つの穴を通り抜ける。

| # | 穴 | 詳細 |
|---|---|---|
| A | `working: true` のまま固まると永久に残る | `armReapForDetached()` が `a.working` で即 return する。許可プロンプトで止まった場合、`Notification` は `waiting` を立てるだけで `working` を下ろさない（`session/activity-hook.ts`）ため、コメントが謳う「waiting は長い猶予つきで回収」に到達できない |
| B | フックが 1 つも発火しないと reap タイマーが武装すらされない | タイマーは WS 切断 / `setWorking(false)` / `setWaiting(true)` からしか張られない。`ws=null` で生成される scheduled セッションには切断イベントが無く、初期プロンプト注入が失敗すると活動フックがゼロになる |
| C | サーバ再起動で全数 orphan 化 | tmux が生き残るのは仕様。だが起動時に回収する処理は無く（`server.listen` のログ出力のみ）、以後誰も触れない |

### Issue の対処案 2（`cleanup-orphans` の定期実行）が効かない理由

`isResumableTmuxSession` は「`~/.claude/projects/` のどこかに `<id>.jsonl` があれば resumable」と判定する
（`claudeOnDiskSessionIds`）。プロンプトが 1 回でも通ったセッションは必ず transcript を書くので、**蓄積して
いる当のセッション群が丸ごと保護対象**になる。このエンドポイントが殺せるのは transcript を書く前に死んだ空
セッションだけで、しかも UI からの呼び出し箇所が無く現状 dormant。

## 方針（ユーザ合意済み）

- スケジュール生成セッション専用のライフサイクル管理を持つ（Issue 案 1 + 案 3 の合成）
- 保持ポリシーは **最新 5 個 かつ 24 時間**
- スコープは **スケジュール由来のみ**＋**原因 A（`working: true` で固まる穴）**。起動時の一律 orphan 一掃
  （原因 C の汎用対処）は今回入れない — 永続化した登録簿がスケジュール由来分だけを再起動後も回収するため、
  #541 の範囲は登録簿で閉じる

## 実装

### 1. `server/session/scheduled-sessions.ts`（新規）

スケジュールが生成したセッション id の登録簿。`~/.mulmoterminal/scheduled-sessions/<workspace>.json` に
永続するので**サーバ再起動をまたいでも回収できる**（原因 C のスケジュール由来分）。完了検知に依存しない
ため、フックが 1 つも来なかったセッション（原因 B）も無条件に回収される。

**ファイルはワークスペース単位**にする。ユーザは 1 つの `~/.mulmoterminal` を複数 clone で共有しており、
共有ファイルにすると全インスタンスが書き込み時にマージする必要がある。その read-modify-write は lost
update を生み、id が黙って消える ＝ リークが戻る（Codex レビュー指摘）。サーバ 1 台 = ワークスペース 1 つ
（同一ワークスペースに 2 台はポート衝突で成立しない）なので、ワークスペース単位なら**書き手は常に 1 つ**に
なり、競合そのものが消える。書き込みは temp + rename の原子的書き込み（`files/atomic-write.ts`、
`backends/feeds.ts` から共通化）で、書き込み中のクラッシュによる破損も防ぐ。

- 純粋関数 `selectExpiredScheduledSessions(records, nowMs, policy)` — 新しい順に `keep` 件を残し、
  それを超えたもの / `ttlMs` を過ぎたものを `expire` に振り分ける
- 純粋関数 `parseScheduledSessions(raw, isValidId)` — 壊れた JSON / 不正 id を落とす
- `createScheduledSessionRegistry(deps)` — `register(id)` / `sweep()`。deps（`reapSession` / `hasTmux` /
  `killTmux`）注入でサーバを起動せずテストできる（`infra/tmux-routes.ts` と同じ形）

expire の処理は `/api/session/:id/terminate` と同じ 2 段構え: `reapSession(id)`（live なら pty + tmux +
cleanup）→ 残った tmux があれば `killTmux(id)`（再起動後の orphan）。ただし**ユーザが開いている
（WS 接続がある）セッションは殺さない** — 既存のリープ機構も attached なセッションには触れないので挙動を
揃える。登録簿には残るので、閉じた後の sweep で回収される。

登録簿の内容は上限 `keep` 件に自動的に収まるので、tmux の生存確認によるプルーニングは行わない
（spawn 直後は tmux がまだ立ち上がっておらず、確認すると登録直後のレコードを取りこぼす）。

### 2. `server/session/reap-policy.ts`（新規）

`armReapForDetached` の判断を純粋関数 `reapDecisionFor(activity, graces)` に抽出し、**`waiting` を
`working` より先に見る**ように順序を直す（原因 A）。既存コメントが宣言している意図
（「ユーザを待っているセッションは長い猶予で回収」）に実装を合わせるだけで、猶予値は変えない。

### 3. `server/index.ts` の配線

- `armReapForDetached` を `reapDecisionFor` 経由に
- `spawnScheduledChat` が `scheduledSessions.register(sessionId)` を呼ぶ
- 起動時に 1 回 `sweep()`、以降 1 時間ごとに `sweep()`（`unref()` 付きなので終了を妨げない）

## テスト

- `test/server/session/scheduled-sessions.spec.ts` — 上限 / TTL / 境界（ちょうど N 個・ちょうど TTL）/
  空 / 不正 JSON / 不正 id / 登録簿の永続と再読込 / expire 時の reap + kill 呼び出し / 開いている
  セッションは見送り、閉じたら回収
- `test/server/session/reap-policy.spec.ts` — waiting 優先、working のみは keep、idle は短い猶予、
  猶予 0（無効化）の扱い
- 実 tmux での確認: アプリと同じ socket に使い捨て `mt-<uuid>` を 2 本立て、登録 → 保持期間内は生存 →
  clock を 25 時間進めて sweep → 2 本とも消滅、既存 7 セッションは無傷（7 → 7）

## 影響しないこと

- transcript は消さないので、回収後もログは読めるし resume もできる
- ユーザが手で開いたセッションの挙動は変えない（登録簿はスケジュール由来 id だけを持つ）
- `waiting` の猶予値（`WAIT_REAP_GRACE_MS`、既定 30 分）は据え置き
