# fix: posix_spawnp failed — node-pty spawn-helper perms on hoisted installs

## 症状

公開版 (`npx mulmoterminal` 0.1.1) で、ターミナル接続時（WebSocket 接続 → `claude`
を PTY 起動）に `Error: posix_spawnp failed.` でサーバーがクラッシュする。

## 原因

`server/fix-pty-perms.js`（postinstall で node-pty の `spawn-helper` を 755 に直す）が
`path.resolve(__dirname, "../node_modules/node-pty/prebuilds")` という**固定相対パス**で
node-pty を探していた。

- リポジトリ（dev）では node-pty が `repo/node_modules/node-pty` にネストするので当たる。
- 一方、利用者の install（`npx` / `npm i`）では node-pty が**トップレベルに hoist** され
  (`<root>/node_modules/node-pty`)、`<pkg>/node_modules/node-pty` には無い → postinstall が
  helper を見つけられず、`spawn-helper` が **644（実行不可）** のまま → `posix_spawnp` 失敗。

ローカルで tgz を hoist レイアウトに install して再現確認済み（helper が 644、spawn 失敗）。

## 修正

- **server/fix-pty-perms.js**: `createRequire(import.meta.url).resolve("node-pty/package.json")`
  で node-pty の実体を解決し（nested/hoist どちらでも）、`prebuilds/*/spawn-helper` を全アーキ
  分 755 に。node-pty 未解決時は no-op で終了。
- **server/index.ts（堅牢化）**: WebSocket 接続時の `spawnClaudePty` を try/catch で囲み、
  spawn 失敗時は**その接続だけ**を閉じてクライアントにエラーフレームを返す（サーバー全体は
  落とさない）。`spawnBackgroundChat` の spawn も同様にガード。

## 検証（ローカル・hoist レイアウトで実機）

- 修正後 tgz を install → `spawn-helper` が **755**、node-pty は `lib/index.js` 解決。
- 単体 `pty.spawn('claude','--version')` → exit 0（バージョン出力）。
- **実 WebSocket を /ws に接続 → `[pty] spawned claude (pid=...)` ＋ 出力ストリーム受信（PTY-OK）**、
  `posix_spawnp` なし。
- `CLAUDE_BIN=/nonexistent` で spawn 失敗 → 接続だけ閉じ、サーバーは生存（`GET / → 200`）。
- `lint` / `typecheck` / `typecheck:server` / `test`(16) / `build` / `format:check` 緑。

## 備考

これは publish 済み 0.1.1 を壊していた回帰。マージ後 0.1.2 として publish 予定。
HTTP `/` だけ見ていた CI の package-smoke では検出できなかったため、WS+PTY も確認すべき。
