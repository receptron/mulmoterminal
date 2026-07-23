# refactor: extract the phone-push body rules (#676 B2)

## Context

`server/session/task-push.ts` の `notifyTaskFinished` は、電話プッシュ本文を組み立てる際に
3 つの判断を I/O に混ぜて持っていた:

```ts
if (hiddenSessions.has(sessionId) || translationWorkerIds.has(sessionId)) return;
const cwd = ptys.get(sessionId)?.cwd ?? null;
const where = cwd ? path.basename(cwd) : "session";
...
const detail = reply || lastPrompts.get(sessionId) || aiTitles.get(sessionId) || "";
```

1. **detail の優先順位** `reply || lastPrompt || aiTitle || ""` — 「エージェントが何をしたか
   = 返信」を最優先し、無ければ last prompt → AI title の順にフォールバック。空文字を飛ばす
   `||` セマンティクスが load-bearing。
2. **抑制ゲート** `hidden || translationWorker` — 隠しバックグラウンドワーカーと翻訳ワーカーは
   実ユーザタスクではないのでプッシュしない。
3. **where 表示** `cwd ? basename(cwd) : "session"` — 作業ディレクトリの basename、無ければ
   sentinel。

いずれも pure な判断だが未抽出・未テストだった (#676 優先度 B2)。

## 変更

- 新ファイル `server/session/taskPushRules.ts` に pure 関数 3 つを切り出し:
  - `buildPushDetail(input: { reply: string | null; lastPrompt: string | undefined; aiTitle: string | undefined }): string`
    — 型は元の値に忠実(`latestReply` は `string | null`、Map の `.get` は `string | undefined`)。
  - `shouldSuppressPush(hidden: boolean, translationWorker: boolean): boolean`
  - `pushWhere(cwd: string | null): string`(`NO_CWD_LABEL = "session"` を named const として公開、`node:path` の basename を使用)
  - すべて **挙動不変**。
- `notifyTaskFinished` は I/O(config 読み・PTY 参照・transcript 読み・sendWebPush)だけ残し、
  この 3 関数を呼ぶ。task-push.ts から `node:path` import を削除(唯一の利用箇所が移動したため)。
- テスト `test/server/session/taskPushRules.spec.ts`:
  - buildPushDetail: 各段優先 / 空文字・undefined スキップ / 全無し → ""
  - shouldSuppressPush: hidden / translationWorker / 両方 / どちらでもない
  - pushWhere: パスあり → basename、null → sentinel

## 検証

- 変異テスト:
  - `shouldSuppressPush` の `||` → `&&` に変えると「hidden のみ / worker のみ」が赤になることを確認して戻す。
  - `buildPushDetail` の優先順を入れ替えると対応テストが赤になることを確認して戻す。
- `prettier --write` / `eslint` / `typecheck`(vue-tsc -b)/ `typecheck:server`(tsc -p tsconfig.server.json)/
  `typecheck:test`(vue-tsc -p tsconfig.test.json --noEmit && tsc -p tsconfig.test-server.json)/
  `vitest run test/server/session`。
