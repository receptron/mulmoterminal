# feat: server を TypeScript 化（第1段階・ゆるい型チェック）(#14)

## ゴール

`server/` を JS → TS に移行し、まずは**ゆるい型チェック**を通せる状態にして CI/開発の土台を作る。strict 化は後続（#14 のチェックリスト）。

## 採用方針

- ランナーは `tsx`（`node --import tsx server/index.ts`）。`.js` 指定子の相互 import をそのまま解決でき、姉妹プロジェクト mulmoclaude と一致。
- Node 24 ネイティブの型ストリップは `.js`→`.ts` 解決をしない（要 `.ts` 拡張子＋`allowImportingTsExtensions`）ため、import 改変の少ない `tsx` を選択。

## 変更

- `tsx` を devDependency に追加。
- `server/*.js`（アプリ本体5ファイル）を `.ts` にリネーム。`fix-pty-perms.js` は postinstall 用の単独スクリプトなので `.js` のまま（インストール時に tsx 非依存）。
- `package.json`: `dev` / `dev:server` / `server` を `node --import tsx ... server/index.ts` に。`typecheck:server`（`tsc -p tsconfig.server.json`）を追加。
- `tsconfig.server.json` を追加（`strict: false` のゆるい設定。メインの build/typecheck には組み込まない＝独立）。
- フラグだけで消えない構造的エラーのみ最小修正（`any`/`as` 不使用）:
  - `pubsub.createPubSub` の `isAllowedOrigin` に型注釈。
  - `index.isAllowedOrigin(origin?)`、`setWorking`/`setWaiting` の `event?` を optional 化。
  - `broker` の dispatch レスポンスを `ToolEnvelope` interface + `isRecord` 型ガードで型付け（undici の `Response.json()` は `unknown`）。

## 確認

- `yarn typecheck:server` ✅ / `yarn lint` ✅ / `yarn test` ✅（16件）
- `tsx` でサーバー起動を確認（`mulmoterminal running at ...`）。

## 後続（このPRには含めない）

- `strictNullChecks` → `noImplicitAny` → `strict` の順で段階的に厳格化（#14）。
- 必要なら本番実行をビルド成果物に切り替えるか検討。
