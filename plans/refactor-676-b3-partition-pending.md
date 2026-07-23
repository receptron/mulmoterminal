# refactor: extract partitionPending pure function (#676 B3)

## Context

`server/session/session-reads.ts` の `collectPendingSessions` は、in-memory の pending
セッション群を「ディスクに載ったものは剪定、それ以外はサイドバー行に積む」判断と、
その副作用(**iterate 中の `knownSessions.delete`**)を同居させていた:

```ts
for (const [id, meta] of includePending ? knownSessions : []) {
  if (onDisk.has(id)) {
    knownSessions.delete(id); // 純判断の途中で破壊的 side-effect
    continue;
  }
  pending.push({ kind: "pending", id, title: meta.title, mtime: meta.createdAt, ... });
}
```

判断は pure 関数として未抽出・未テストだった (#676 優先度 B3、テスト 0)。壊れると
ディスクに載った session の剪定が狂い、サイドバーに古い pending 行が残る/消える。

## 変更

- 新ファイル `server/session/partitionPending.ts` に pure 関数 `partitionPending` を切り出し。
  - シグネチャ: `partitionPending(known: Iterable<[string, KnownSession]>, onDisk: Set<string>, activityOf, isHidden): { keep: PendingSession[]; persisted: string[] }`
  - `keep` = pending に積む `PendingSession`(入力順を保持)、`persisted` = onDisk に載っていて
    `knownSessions` から消すべき id。
  - `working/waiting/event` の解決(`activity.get(id)`)と `hidden`(`hiddenSessions.has(id)`)は
    純度を保つため関数 `activityOf`/`isHidden` として**注入**する。元と同じ `?? false` / `?? null`
    デフォルトを維持。
- `collectPendingSessions` は `includePending ? knownSessions : []` を `known` として渡し、
  `partitionPending` を呼ぶ。返った `persisted` を使って `knownSessions.delete(id)`(= 書き込み I/O)
  を呼び出し側で行い、`keep` をそのまま返す。**挙動不変**(iterate 中 delete → iterate 後 delete は、
  訪問集合・削除集合ともに同一)。

## テスト `test/server/session/partitionPending.spec.ts`

- onDisk に載る id → `persisted` に入り `keep` に入らない
- 載らない id → `keep` に `PendingSession` として積む(全フィールドの形を検証)
- 注入した activity/hidden から `working/waiting/event/hidden` を導出
- 空 known / 全部 onDisk / 混在
- keep・persisted の順序保持
- 生の `Map` iterable も受ける

## 検証

- 変異テスト: `if (onDisk.has(id))` を `if (!onDisk.has(id))` に反転 → spec の 8 件中 7 件が赤に
  なることを確認して戻す。
- `prettier --write` / `eslint` / `typecheck`(`vue-tsc -b`)/ `typecheck:server` /
  `typecheck:test`(`vue-tsc -p tsconfig.test.json --noEmit` + `tsc -p tsconfig.test-server.json`)/
  `vitest run test/server/session`(43 files / 770 tests green)。
