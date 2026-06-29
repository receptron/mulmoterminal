# feat: server TypeScript を strict 化（第2段階）(#14)

## ゴール

第1段階（#16, tsx 実行 + ゆるい型チェック）の続き。`tsconfig.server.json` を
`strict` に戻し、出てくる型エラー（約80件）を**実際の型付けで**すべて解消する。
`any` / `as` は使わない。

## 変更

- `tsconfig.server.json`: `strict: true` + `noUnusedLocals` / `noUnusedParameters`
  を有効化。
- `server/index.ts`:
  - データ形状を interface 化（`Activity` / `PtyEntry` / `KnownSession` /
    `ToolResult` / `ToolCall` / `SessionMeta` / `DiskStat` / `PendingSession`）。
  - `Map` をジェネリクスで型付け。`createSessionStore<T>` を導入。
  - `pubsub` を `ReturnType<typeof createPubSub> | null` で型付け。
  - `/api/sessions`: `DiskStat | PendingSession` の判別可能 union と型ガード
    付き `filter` で null / プロパティ欠落エラーを解消。errno は `hasErrnoCode`
    ガードで `.code` を参照。
  - WebSocket 接続ハンドラの `entry` を `let entry: PtyEntry` にして、クロージャ
    内で `undefined` 扱いにならないようにする。
  - `catch (e)` は `messageOf(e)` ヘルパで安全にメッセージ化。
- `server/pubsub.ts` / `plugins-registry.ts` / `mcp/broker.ts` /
  `backends/image-gen.ts`: 関数引数・変数に実型を付与（`http.Server`、`Express`、
  `GoogleGenAI` 等）。broker のレスポンスは `ToolEnvelope` + `isRecord` で型付け。

## 確認

- `yarn typecheck:server` ✅（strict）/ `yarn lint` ✅ / `yarn test` ✅（16件）
- `yarn typecheck`（vue-tsc）✅ / `yarn build` ✅（フロントは無影響）
- `tsx` でサーバー起動を確認。

## 完了後

#14 の「型チェック厳格化」を達成。残タスクがあれば #14 に集約。
