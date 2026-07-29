# fix #1085 — `/clear` 後の cockpit roster に clear 前のサマリー・返答が残る

## 症状

grid view のサイドメニュー (cockpit roster) の行に出る **summary (AI タイトル)** と **response (直近の返答)**
が、`/clear` した後も clear 前の会話の内容を出し続ける。clear 直後にいったん消えても、次のターンが
終わると戻ってくる。

## 根本原因

`/clear` すると Claude Code は**新しい session_id と新しい transcript (`.jsonl`) に切り替える**。
mulmoterminal は hook を `x-mt-session` ヘッダで自分の id に固定している (`server/session/hook-settings.ts`)
ため、`${mtId}.jsonl` は **clear 時点で凍結され、二度と伸びないファイル**になる。

`clearHeaderPrompt` (`server/routes/hook-routes.ts`) が消すのはメモリ上の値だけなので、その凍結ファイルを
読む経路が clear 前の内容を書き戻す:

| # | 経路 | 何が戻るか |
|---|------|-----------|
| 1 | `session-title.ts` `generateAndStoreTitle` | `forgetTitle` で `hasTitle=false` → 次ターンで再生成が走り、凍結 transcript から clear 前のタイトルを作り直す |
| 2 | `lifecycle.ts` `refreshLastResponse` | ターン終了時に凍結 transcript の最後の返答を `lastResponses` に書き戻す |
| 3 | `task-push.ts` `notifyTaskFinished` | 完了 push が同じ transcript を読み `lastResponses` を更新する (push 本文も clear 前の返答になる) |
| 4 | `src/components/rosterPhase.ts` `mergeSessionMeta` | `fetched.aiTitle ?? previous.aiTitle` なので、サーバが `aiTitle: null` と答えても roster は前の値を保持する |

1〜3 はサーバ側の「復活」、4 はクライアント側の「保持」。両方直さないと消えない。

## 方針

「この id の transcript はもう live な会話を表していない」という**事実そのもの**を 1 か所に持ち、
そこから読む側をガードする。id を新しい claude session に付け替える (追従する) 案は変更範囲が広く、
本 issue のスコープ外とする。

### サーバ

- `server/session/cleared-transcripts.ts` (新規) — マークの本体 `clearedTranscripts: Set<string>` と、
  その永続化。
- `server/routes/hook-routes.ts` `clearHeaderPrompt` — SessionStart source=clear で `markTranscriptCleared`。
- `server/session/lifecycle.ts` `reap` — teardown で `forgetClearedTranscript`。claude が `/exit` した
  場合も `term.onExit` → `reap` を通るので、次に同じ id を `--resume` したときは解除済みになる。
- `server/session/activity-transition.ts` `shouldRefreshReply` — 判断を純粋関数側に置き、
  `transcriptCleared` を受けて false を返す。
- `server/session/task-push.ts` — cleared の間は transcript を読まない (push 本文も
  clear 前の返答を語らない)。
- `server/session/session-title.ts` `generateAndStoreTitle` — cleared の間は生成しない。
  凍結ファイルから作れるのは「ユーザーが今終わらせた会話」のタイトルだけなので。

結果、cleared の間サーバは一貫して `aiTitle: null` / `lastResponse: ""` を返す。

### マークの永続化 (Codex レビュー指摘)

マークを in-memory だけにすると、**`/clear` → reap 前にサーバ再起動** で消える。tmux はセッションの
claude を生かしたまま (activity state を永続化しているのと同じ理由) なので、再起動後の次のターンで
凍結 transcript を読み直し、修正前の挙動に戻ってしまう。

そこで `<MULMOTERMINAL_HOME>/cleared-transcripts/<id>.json` に `{ cwd, size }` を書く。

- **id ごとのファイル**: home は同じ場所を指す複数サーバで共有されるので、単一 JSON への
  read-merge-write は先に終わった方の書き込みを失う (registry.ts が id ログについて言っているのと
  同じ理由)。id は 1 サーバに属するので id ごとなら競合しない。
- **size を持つ**: マークが自然に失効するための唯一の手がかり。後から `--resume` するとその
  ファイルに追記されるので、記録より大きい = claude がまた書いている = マークは無効。これが無いと、
  reap 前に落ちたサーバが残したマークが、resume 後のセッションのサマリーを永久に黙らせる。
- **hydrate は import 時ではなく `index.ts` の boot で 1 回**。読み手が同期なので listen 前に
  終わっている必要があり、また hydrate は失効マークを削除するため、import 時に走ると
  このモジュールを読む spec すべてが実際の home に触れてしまう。

マークが戻っても、`""` センチネル**そのもの**は再起動で消えるので、それを前提にしていた 2 か所も
マークを見るようにする (自分のレビューで発見):

- `server/session/session-detail-view.ts` — `live.lastResponse` が無い (再起動後) とき、cleared なら
  transcript ではなく `""` を返す。`null` ではなく `""` なのは、roster の merge を通り抜けて行を
  消せるのは値である `""` だけだから。
- `server/routes/hook-routes.ts` `trackPromptForHeader` — cleared なら transcript から
  ヘッダープロンプトを seed しない (復元すべきタスクは無く、読む先は終わった会話)。

### クライアント

- `src/components/rosterPhase.ts` `mergeSessionMeta` — `aiTitle` はキーが存在すれば
  `null` でもそのまま採用する (キー欠落のみ「更新なし」)。`cellActivity.ts` が既に採用している
  ルールと同じ。`lastPrompt` / `lastResponse` は transcript フォールバックが一時的に空振りしうるので
  従来どおり sticky のまま (cleared のときサーバは `""` を返すので `??` を素通りする)。

## テスト

- `test/server/routes/hook-clear.spec.ts` — SessionStart source=clear で prompt/reply が空になり、
  マークが立ち、hook が報告した cwd がマークに渡る。`source=compact` では何も起きない。
- `test/server/session/cleared-transcripts.spec.ts` — マークの書き込み / 再起動後の復元 /
  transcript が伸びていたら失効 / 壊れたマーカーの破棄 / セッション id でないファイルは触らない。
- `test/server/session/session-title.spec.ts` — cleared のセッションはタイトルを再生成しない。
- `test/server/session/activity-transition.spec.ts` — `shouldRefreshReply` が cleared で false。
- `test/server/session/lifecycle.spec.ts` — `/clear` 後のターン終了で `lastResponses` が復活しない / reap で解除。
- `test/src/components/rosterPhase.spec.ts` — `aiTitle: null` で消える、キー欠落なら保持。

## スコープ外 (別 issue 候補)

`usage` / `context` / `workPhase` も同じ凍結 transcript 由来で、`/clear` 後は clear 前の値のまま固まる
(実測: cacheRead 98,446,861 / ctx 374,012 tokens のまま動かない)。根本的には mt id と claude の
現 session_id を対応付けて新しい transcript を読むべきで、それは本 issue とは別に扱う。
