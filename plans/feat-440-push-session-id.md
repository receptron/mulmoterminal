# feat #440 — プッシュ通知にセッション ID を載せる

Issue: #440。セッション完了時（Claude Code の `Stop` フック）に既にプッシュを飛ばしているが、
セッション ID が乗っていないためタップしてもホーム画面に着く。

`mulmoterminal@1.4.0` でスマホからセッション画面を見られるようになった（`/terminals/{id}`）ので、
タップで該当セッションに着地させる。

## 依存（解決済み）

| | |
|---|---|
| receptron/mulmoclaude#2230 | `@mulmobridge/web-push` に `data` を通す。**0.2.0 公開済み** |
| receptron/mulmoserver#75 | Cloud Function が転送、受信側が読む。**マージ済み**（#77） |

この PR は送信側。3リポジトリにまたがる作業の最後の1つ。

## 変更

差分は小さい。`notifyTaskFinished` は既に `sessionId` を引数で受け取っており、
表示文字列の組み立てにしか使っていなかった。

- `package.json` — `@mulmobridge/web-push` を `^0.2.0` へ
- `server/infra/web-push.ts` — `data?: Record<string, string>` を受けて `sendPush` に渡す
- `server/index.ts` — `sendWebPush(title, body, { sessionId })`

## 設計上の注意

- **`notification` は残る。** `data` は `sendPush` のオプションとして**追加**されるもので、
  置き換えではない。受信側2箇所とも `!notification` で早期 return するため、data-only の
  プッシュは無言で捨てられる
- **`data` が無い呼び出しは従来どおり。** `buildSendPushBody` は空の `data` を省くので、
  ワイヤ形式も既存と同一になる

## 検証

送信側が組む body を受信側（マージ済み mulmoserver の `sanitizePushData`）に通し、
`sw.js` の遷移先算出まで再現して確認した:

```
送信ボディ: {"data":{"title":"✅ mulmoterminal","body":"...","data":{"sessionId":"8b1f2c4e-..."}}}
routing   : {"sessionId":"8b1f2c4e-..."}
遷移先     : /terminals/8b1f2c4e-...
```

`data` 無しの既存送信が退行していないことも同時に確認した（遷移先 null ＝ focus のみ）。

## スコープ外

- `Notification`（ユーザーの応答待ち）でプッシュが飛ばない件。`shouldNotifyTaskFinished` が
  `Stop` のみを対象にしている既存の穴で、この PR とは独立
