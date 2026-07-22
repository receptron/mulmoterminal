# fix: docker sandbox のトークン期限切れログイン不能

Issue: #492

## 背景・根本原因

macOS の Claude Code は OAuth トークンを Keychain で保存・**更新**し、`~/.claude/.credentials.json` には
書かない。sandbox は `writeSandboxCredentials` で Keychain の値をファイルに export してコンテナへ渡すが、
**期限チェックも更新もない**。Keychain のトークンは数時間で切れるため、切れた状態で export すると
コンテナは 401 →「NOT LOGGED IN」。ホストの claude は実行時に自動更新するが、それを発火していない。

mulmoclaude2 が同じ問題を `server/system/credentials.ts` で解決済み（`plans/done/credential_issue.md`）。

## 実測（mac docker）

- 有効トークンでは現行のまま `claude -p` が `AUTH_OK`（機構・credential の形は正しい）
- credential は `{"claudeAiOauth":{...}}` を verbatim で正しい（ラッパー/ env var 不要）
- `:ro` マウントは refresh 書き戻しをブロック（`WRITE_BLOCKED`）、RW は許可（`WRITE_OK`）

## 修正（mulmoclaude2 準拠 + mulmoterminal 向け調整）

### `server/infra/sandbox.ts`

純粋関数（エクスポート・単体テスト対象）:
- `readExpiresAt(raw: string): string | null` — `claudeAiOauth.expiresAt` を型ガード付きで取り出す
- `isTokenExpired(raw: string): boolean` — 60s マージンで判定、パース不能は expired 扱い
- `looksLikeClaudeResponse(text: string): boolean` — PTY renewal の成功判定（会話的な応答 + 最低文字数）

副作用あり（薄いラッパー、テストは純粋関数側で担保）:
- `refreshHostKeychainIfExpired(claudeBin: string): Promise<void>`
  - Keychain 読取 → 期限内なら no-op
  - 期限切れなら**ホストの claude を node-pty で起動**し、初期プロンプト待ち後 `"hi\r"` を送信、
    エコー後に応答らしきテキストを待つ（30s timeout）→ プロセス kill
  - Keychain 再読取 → まだ期限切れなら失敗ログ（stale を書かない安全網）
  - 実際の書き出しは既存の `writeSandboxCredentials`（refresh 後の Keychain を読む）に委ねる

node-pty は本アプリの恒常依存なのでトップレベル import（mulmoclaude2 の dynamic import は不要）。
claude バイナリは `CLAUDE_BIN` 尊重（`claudeAdapter.bin()`）。

### `server/index.ts`

- sandbox 判定を関数化して DRY:
  `sandboxWouldRun(attachGuiMcp: boolean): boolean = sandboxEnabled() && sandboxPlatformSupported()
   && attachGuiMcp && dockerAvailable() && sandboxImageExists()`
  （`spawnClaudePty` 内の既存ゲートと WS ハンドラで共有）
- `wss.on("connection")` を async 化し、sandbox spawn 前 / reconnect の credential 再同期前に
  `await refreshHostKeychainIfExpired(CLAUDE_BIN)` を挟む。ゲートで sandbox 時のみ実行

### `buildDockerRunArgs`

- credential マウントを `:ro` → RW。per-session の使い捨てコピーなのでホストは汚さない。
  長時間 interactive セッション中の期限切れ refresh を可能にする defense-in-depth
  （mulmoterminal は headless の mulmoclaude2 と違い長時間 TUI）

## テスト

`test/server/infra/sandbox.spec.ts` に追加:
- `readExpiresAt`: 正常 / claudeAiOauth 無し / expiresAt 無し / パース不能 → null
- `isTokenExpired`: 未来（valid）/ 過去（expired）/ 60s マージン境界 / 不正 JSON → expired
- `looksLikeClaudeResponse`: 会話応答 true / エラー文言 false / 短文 false

PTY renewal 本体は副作用があるため単体テスト対象外（mulmoclaude2 と同方針）。

## スコープ外

- Windows/Linux での sandbox 有効化（ゲートは darwin のまま）
- env var / apiKeyHelper / JSON エンベロープ変更（不要と実測確認済み）
