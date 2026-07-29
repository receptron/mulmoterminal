# feat(feeds): 定期 refresh の `onComplete` を繋ぐ (#1070)

## 何が落ちているか

`@mulmoclaude/core/feeds` の `AgentWorkerRunner` は hidden ワーカー向けに一発限りの完了フックを
渡してくるが、`server/index.ts` の `feedsSpawnWorker` は `{ message, hidden }` しか
分割代入しておらず、**`onComplete` を捨てている**。

エンジン側は受け取れば動く実装が揃っている（`dist/feeds/server/index.js`）:

| | 内容 |
| --- | --- |
| 失敗時 `onWorkerError` | `consecutiveFailures` を +1、`log.warn`、**失敗ベルを publish**（"Collection refresh failed" → `/collections/<slug>`）、ベル id を state に保存 |
| 成功時 `onWorkerSuccess` | `log.info`、**既存の失敗ベルを clear**、`consecutiveFailures` を 0 に戻す |

受け側の `initNotifier` も `collectionWatchers` も配線済み。**出すきっかけを捨てているだけ。**

#1067 で背景セッションを既定の一覧から外し、さらに刈り取り（最新 5 件 / 24h）に載せたので、
失敗の唯一の痕跡だったサイドバーの行は**時間制限つき**になった。繋ぐべきタイミングは今。

## MulmoClaude はどうしているか（そして、なぜそのまま使えないか）

`../mulmoclaude` の答え:

- `server/agent/backgroundSessions.ts` — 一発限りのフック登録簿
  （`registerCompletionHook` / `unregisterCompletionHook` / `runCompletionHook`）。
  id は `SESSION_ID_RE` で検証してから引く。メモリのみ（再起動で落ちるが、次の tick が再 dispatch する）
- `server/api/routes/agent.ts` `spawnSystemWorker` — spawn 成功後に hidden のときだけ登録
- 同 `finalizeRun` — `runAgentInBackground` の `finally` から `runCompletionHook(id, { didError })`

**`didError` の出どころが移植できない。** MulmoClaude は Agent SDK を**プロセス内**で回すので
run 全体を `try/catch/finally` で包める。MulmoTerminal は `claude` CLI を **PTY の子プロセス**として
回すので、包む対象がない。

→ **登録簿の形は借りる。`didError` の導出だけ MulmoTerminal 独自にする**（CLAUDE.md
「Deliberate divergence is fine — say so in a comment with the reason」に従い、コメントで理由を書く）。

## `didError` の判定

MulmoTerminal で使える終了シグナルは 3 つ:

| シグナル | 分かること |
| --- | --- |
| `Stop` フック | ターンが 1 つ終わった |
| `term.onExit` | プロセスが死んだ（→ そのまま `reap`） |
| `reap` | セッションが畳まれた（idle grace / waiting grace / scheduledSessions の retention） |

**採用する規則: `didError` = 一度も `Stop` を出さないまま終わったか。**

- 成功した refresh は必ず `Stop` を出す
- permission プロンプトで固まったワーカーは `Notification` 止まりで `Stop` を出さない
- 起動時クラッシュ / workspace-trust ダイアログでのハングも `Stop` を出さない

実装は一発限りの登録簿がそのまま体現する:

- `Stop` フック → `runCompletionHook(id, { didError: false })`
- `reap` → `runCompletionHook(id, { didError: true })` — 一発限りなので、
  `Stop` が既に消費していれば no-op

### `Notification` で即座に失敗にしない理由（重要）

「hidden なワーカーが permission プロンプトで止まったら、誰も答えられないのだから即失敗で
よいのでは」と考えたが、**フックが一発限りである以上これは壊れる**。

ブロック中に `didError: true` を撃つ → 失敗ベルが上がる → ユーザーが Background チップから
開いて答える → ワーカーが成功して終わる → **しかしフックはもう消費済み**なので
`onWorkerSuccess` のベル解除が走らない → **ベルが消えないまま貼り付く**。

終端イベント（reap / exit）まで待つ。ブロックしたまま放置されたワーカーは
waiting grace（既定 30 分）か `scheduledSessions` の retention で reap され、そこで失敗になる。

## 実装

| ファイル | 内容 |
| --- | --- |
| `server/session/completion-hooks.ts` | 新規。一発限りの登録簿。MulmoClaude の同名 API に合わせる（`registerCompletionHook` / `unregisterCompletionHook` / `runCompletionHook`）。id を `SESSION_ID_RE` で検証してから引く |
| `server/index.ts` `feedsSpawnWorker` | `onComplete` を受け取り、**spawn 成功後**に hidden のときだけ登録 |
| `server/routes/hook-routes.ts` | `Stop` を見たら `didError: false` で発火 |
| `server/session/lifecycle.ts` `reap` | `didError: true` で発火（Stop 済みなら no-op） |

順序の注意: 登録は spawn が成功したあと。spawn が投げた場合は登録しない
（MulmoClaude も同じ順序で、理由もコメントに書いてある）。

## テスト

`test/server/session/completion-hooks.spec.ts`:

- 登録したフックが 1 度だけ走る／2 度目は no-op（一発限りの契約）
- `Stop` 相当（`didError:false`）のあとに `reap` 相当（`didError:true`）が来ても**上書きされない**
  — 貼り付きベルを防ぐ規則そのもの
- 未登録 id は no-op、不正な形の id は引かない
- `unregisterCompletionHook` で発火しなくなる
- 投げるフックは呼び出し側が catch できるよう reject する（握り潰さない）

## やらないこと

- `spawnBackgroundChat`（プラグインの hidden spawn）には `onComplete` を足さない —
  エンジンが渡してくるのは feeds の agent-ingest だけで、プラグイン側に受け手がいない
- 手動 Refresh（`hidden:false`）はエンジン側が `onComplete` を渡さない。見えるセッションを
  ユーザーが直接見るのが答えなので、こちらも何もしない
