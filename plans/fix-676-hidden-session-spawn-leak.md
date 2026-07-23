# fix: don't leak a hidden-session marker when the spawn throws (#676 ついで)

対象 issue: https://github.com/receptron/mulmoterminal/issues/676（「ついで」節）

## 問題

`spawnBackgroundChat`（`plugin-routes.ts`）と `feedsSpawnWorker`（`index.ts`）は
`if (hidden) hiddenSessions.add(sessionId)` を spawn の**前**に実行し、spawn が throw しても
その id を集合から取り除かない。id はランダム UUID で他に reap する経路が無いため、失敗した
hidden spawn ごとにマーカーがプロセス終了まで滞留する（軽微だが恒久的なリーク）。

## 修正

判断を pure な higher-order 関数に切り出す:

```ts
runWithHiddenMarker(hidden, sessionId, markers, spawn)
```

spawn 前にマーカーを付け（mid-spawn の hook が hidden を見られるよう add は前）、spawn が
throw したら delete して再 throw する。`plugin-routes.ts` と `index.ts` の 2 箇所を置換。
`hiddenSessions`（Set）を `markers` として渡す。挙動は成功時不変・失敗時にリークが消える。

## テスト

`test/server/session/hiddenMarker.spec.ts`: 成功でマーカー維持 / throw で add→delete され再 throw /
hidden=false では add/delete を一切呼ばない（成功・throw 双方）。catch の delete を外すと
「throw でマーカーが残らない」テストが赤・戻すと緑を変異テストで確認済み。
