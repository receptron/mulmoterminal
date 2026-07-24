# fix: 起動ポーリング多重化 + 孤児 tmux 誤 kill + mutate too-large 誤報（#747）

## User Prompt

> mulmoclaude で全ファイルをレビューして…（略）バグを issue 化し、順に対応・CI・レビュー対応・マージまで進める

## 1. `waitUntilReady` がタイムアウトのたびにポーリングを分裂させる（`bin/mulmoterminal.js`）

timeout ハンドラで `req.destroy()` を呼ぶと 'error' イベントが発火し、`req.on("error", retry)` が
**もう一度** retry を呼ぶ。1リクエストのタイムアウトで retry が 2 回 → ポーリング連鎖が指数的に分裂し、
サーバ応答時に各連鎖が onReady を呼んでバナー多重表示・ブラウザ多重起動になる。

**修正**: ポーリングロジックを `bin/wait-ready.js`（+ `.d.ts`）に切り出し、注入可能に。
`probeOnce(get, port, timeoutMs)` が1プローブにつき **必ず1つの結果**（"ready"/"retry"）を返す
（Promise + settled ラッチ）。`waitUntilReady` は直列ループ（await）で fork 不可能。`mulmoterminal.js` はこれを import。

## 2. cleanup-orphans が他プロセスの生きた tmux セッションを kill（`server/infra/tmux-routes.ts`）

`resumablePredicate` は自プロセスの live/grid/on-disk しか見ないため、別の mulmoterminal が
新規作成してまだトランスクリプトの無いセッションを「resumable でない」と判定して kill する。

**修正**: `orphanReapable(resumable, attachedCount)` を pure 関数として追加。
cleanup 到達時点で id は自プロセスの live に無い（あれば resumable で除外済み）ので、
`attachedCount >= 1` は他プロセスが保持を意味する。resumable でない **かつ** attachedCount === 0 のみ kill。
null（tmux が答えられない）は「保持」として安全側に倒す。dep `attachedClientCount: tmuxAttachedClientCount` を配線。

（メモリの follow-up「別プロセスが同じ dir/セッションを共有したら警告」と同根の問題）

## 3. mutate の too-large で書き込み済みなのに 400（`server/backends/mutateStatus.ts` 他）

`too-large` は「更新は成功したが応答が大きすぎる」ケース（メッセージが明言）。
`mutateStatus` が 400 に落とすため、UI が編集失敗と表示し古いデータを保持する。

**修正**: 型ガード `mutateWriteApplied(result)` を追加（`too-large` を narrow）。
デスクトップ preview（`collections.ts`）とスマホ channel（`remoteHost/handlers.ts`）の両ハンドラで、
`too-large` を成功扱い（`{ op, id, applied: true, warning }`）にし、クライアントに refetch を促す。

## テスト

- `test/bin/wait-ready.spec.ts`（新規）: probeOnce の ready/retry、timeout+destroy 二重発火でも単一結果、
  onReady が retry を挟んでも1回、readyTimeout で諦め、cancel で停止。ready 時 return 削除のミューテーションで赤。
- `test/server/infra/tmux-routes.spec.ts`: 他プロセスがアタッチした非 resumable を spare、`orphanReapable` の真理値表。
  attachedCount を無視するミューテーションで赤。
- `test/server/backends/mutateStatus.spec.ts`: `mutateWriteApplied` の真偽、too-large を 400 リストから除外。
  常に false のミューテーションで赤。

全 3551 テスト + typecheck（server/test/app）+ lint + build パス。
