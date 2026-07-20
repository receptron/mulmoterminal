# feat #439 — セッションの活動状態を Firestore に publish する

Issue: #439。スマホのターミナル閲覧（#435 split 2）を、ポーリングではなく**変化したときに**
更新できるようにするためのホスト側。対になるスマホ側は receptron/mulmoserver#74。

## なぜ新しい doc が要るか

調査で確認した事実:

- ホストが Firestore に書くのは **presence doc とコマンド doc の2つだけ**
- presence doc は5フィールドのみでセッション情報ゼロ。しかも `@mulmoclaude/core` 内で
  組み立てられ、60秒ごとに `setDoc` で**全上書き**されるため外からは拡張できない
- `pubsub.ts` はデスクトップのブラウザ向け socket.io で、Firestore には届かない。
  `publish` しか export しておらず、サーバ側から購読することすらできない

`users/{uid}/hosts/{hostId}/sessions/{sessionId}` なら既存のルール
`users/{uid}/hosts/{document=**}` で通り、**core の変更もルール変更も不要**。

## 設計

### `server/backends/remoteHost/sessionActivity.ts`（新規）

```
{ rev: number, working: boolean, waiting: boolean, at: <serverTimestamp> }
```

`rev` はセッションごとに単調増加。watcher が「また変わった」と「同じ値の再配信」を
区別できるようにするため。

Firestore の IO を `SessionActivityStore` として分離し、テストでは記録用の fake を注入する。

### 書き込み地点は `publishActivity`

`setWorking` / `setWaiting` の両方がここに合流するので、フックは1箇所で済む。

**ただし `publishActivity` の呼び出し4箇所のうち2つは活動遷移ではない** —
AI タイトル生成（`server/index.ts:1346`）とヘッダクリア（`:1304`）は working/waiting が
変わらないまま再 publish する。そのまま Firestore に流すと無駄な write が出るうえ、
watcher 側が「変わっていない画面」を取りに行ってしまう。

そこで publisher 側で **直近に publish した working/waiting を保持して重複排除**する。
呼び出し側を選ぶより、publisher が常に正しく振る舞う方が将来の呼び出し追加にも強い。

## 実装上の注意

- **`currentFirestore()` は切断中に throw する**（`session.ts:78` の `requireHandles`）。
  `currentUid()` は null を返すだけなので、**uid の null チェックを先に置く**ことで
  throw を回避する。uid が非 null なら handles が存在するので firestore は throw しない
- **fire-and-forget**。呼び出し元は Claude Code のフックを捌く同期パス上にあるので、
  Firestore の失敗が絶対に伝播してはいけない。`.catch(onError)` で握る
- `reap()` で `forget()` を呼び doc を消す。残すとスマホの一覧に幽霊が出る。
  ローカルの記録は切断中でも消す（同じ id で復活したセッションが古い dedup キーを
  引き継がないように）
- `HOST_ID` を export する（doc パスを組むため）

## テスト

`test/server/backends/remoteHost/sessionActivity.spec.ts` — 記録用 store を注入して:
遷移の書き込み / 同一スナップショットの無視 / 再変化での rev 増加 /
セッションごとの rev / 切断中の no-op / reap での削除 / id 再利用時のリセット /
write 失敗が呼び出し元に伝播しないこと。

実サーバでも `/api/hook` に `UserPromptSubmit` と `Stop` を投げ、**未接続状態で**
200 が返ること・例外が出ないことを確認した。

## スコープ外

- スマホ側の購読（receptron/mulmoserver#74）
- 一覧ページへの working/waiting 表示。doc には乗るが、まず画面更新に絞る
