# feat #267 — サマリーから「Continue in Claude」

案A（確定）。Run セルの ✦ Summary パネルに「Continue in Claude」を追加し、`command.cwd` で
編集可能な初期プロンプト付き Claude セッションを起動する。

## 実装
- **サーバ** `server/index.ts`: `POST /api/plugin/spawnBackgroundChat` が `body.cwd` を受け取り
  `resolveWorkspace(cwd)` で解決して `spawnClaudePty(..., cwd, ...)` に渡す（従来は CLAUDE_CWD 固定）。
- **クライアント** `useChatLauncher.startCollectionChat(prompt, { draft, cwd })`: `cwd` を POST body に追加。
- **UI** `CommandCell.vue`: Summary パネルにボタン。`continueInClaude()` が
  `command.label` + 要約から簡潔な draft を作り `startCollectionChat(prompt, { draft:true, cwd:command.cwd })`。
  既存の `registerChatOpener`（App.vue）でセッションを開く。

## 設計判断
- draft はサーバで**1行に平坦化**（制御バイト除去）されるため、生出力は載せず **command + 要約のみ**の簡潔な draft に。必要なら Claude が再実行して詳細を得られる。
- 表示先は既存 opener（単一ビュー）を再利用（MVP）。グリッドセル起動は follow-up。
- Claude 固定（Codex は follow-up）。自動「修正」（案C）は非スコープ。

## 非スコープ
- 生出力全文の受け渡し（平坦化のため）／グリッドセル起動／Codex／自動送信
