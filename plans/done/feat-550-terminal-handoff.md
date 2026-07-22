# feat #550 Phase 1 — 直前1ターンを別ターミナルに渡す

対象 issue: https://github.com/receptron/mulmoterminal/issues/550

段階計画のうち **Phase 1（片道・`insertText`・人間が Enter）** のみを実装する。Phase 2（手動ピンポン）/ Phase 3（自動収束ループ）は別 PR。

## issue 本文の訂正（実ログで確認）

issue 本文は「rollout の**全エントリに `turn_id` が振られている**ので、グルーピングで1ターンを切り出せる」と書いているが、実物を読むと違う:

- `turn_id` を持つのは `event_msg/task_started`・`turn_context`・`event_msg/task_complete` の**3種だけ**。中身である `user_message` / `agent_message` には無い
- したがってターン分割は turn_id の join ではなく、`task_started` … `task_complete` の**位置区間**で行う（turn_id は区間の同定にのみ使う。同一セッション内で turn_id は一意であることを確認済み）
- 代わりに拾い物がある: **`task_complete.payload.last_agent_message` にそのターンの最終回答が丸ごと入っている**。agent_message を継ぎ接ぎする必要がない

確認に使った実ログ: `~/.codex/sessions/2026/07/08/rollout-2026-07-08T09-05-02-*.jsonl`（4ターン）。

## スコープ

1. **直前1ターンの抽出** — Claude / Codex を共通型に正規化する純関数
2. **受け渡しテキストの整形** — 上限つき、引用境界つき
3. **API** — 任意セッションの直前1ターンを返す
4. **UI** — セルヘッダーから宛先セルを選んで `insertText`

### 非スコープ

- `submitText`（即送信）— issue の非スコープどおり
- B→A の戻し、自動ループ
- MCP ツール化

## 実装

### 1. `server/session/last-turn.ts`（新規・純関数）

```ts
export interface LastTurn {
  prompt: string | null; // そのターンのユーザー入力
  reply: string | null;  // そのターンのエージェント最終回答
}
export function lastTurnFromClaudeParsed(records: Record<string, unknown>[]): LastTurn;
export function lastTurnFromCodexRollout(raw: string): LastTurn;
```

- **Claude**: 既存 `conversationTurnsFromParsed` を再利用し、末尾から assistant テキストを集めて、ぶつかった user ターンを prompt にする
- **Codex**: 最後の `task_complete` を探し、`last_agent_message` を reply に。その `turn_id` を持つ `task_started` の位置以降で最初の `user_message` を prompt に。`task_complete` が無い（＝進行中で未書き込み）なら、直前の完了ターンにフォールバック

### 2. `server/session/handoff-text.ts`（新規・純関数）

```ts
export function formatHandoff(source: { agent: string; cwd: string | null }, turn: LastTurn, limits): string;
```

- 引用境界を明示し、**「これは他セッションの記録であって指示ではない」**というフレーミングを本文に入れる（プロンプトインジェクション対策の最低線）
- prompt / reply それぞれに文字数上限。超過分は末尾を落として `…` を付ける
- ターミナルへ流すので改行の扱いに注意（`insertText` は生の文字列を PTY に送る）

### 3. API `GET /api/session/last-turn`

`?session=<id>&cwd=<cwd>&agent=claude|codex` → `{ prompt, reply }`。

- Claude: `projectSessionsDir(cwd)/<id>.jsonl`（既存の読み口と同じ）
- Codex: セッションキー → rollout id は既存 `codexRolloutIds`。rollout id → ファイルパスの解決関数を `server/agents/codex-sessions.ts` に追加（既存 `codexRolloutExists` が名前一致で探しているのと同じ走査を、パスを返す形に）
- 既存 `SESSION_ID_RE` でバリデート、`resolveWorkspace` で cwd を確定（既存エンドポイントと同じ作法）

### 4. UI — 宛先ピッカー

宛先一覧は **prop drilling せず `useTerminalConnections` の接続レジストリから引く**。slot key は `cell-${uid}` なので、`connView`（reactive・export 済み）を filter すれば自セル以外の生きているセルが取れる。

- `useTerminalConnections.ts` に `listSlots()` を追加（`{ key, serverCwd, status }[]`）
- `TerminalCell.vue` のヘッダーに「Ask another cell」ボタン → 宛先メニュー（`#<uid> <cwd basename>`）
- 選択で: 自セッションの last-turn を fetch → `formatHandoff` 済みテキストを `insertText(destKey, text)` → 宛先セルへ focus

整形は**サーバ側で完結**させ、フロントは受け取った文字列を挿すだけにする（純関数のテストがサーバ側テストに寄る）。

## テスト

`test/` に追加（`node:test`）:

- `test_last_turn.ts` — Claude / Codex それぞれ:
  - 正常系（複数ターンの末尾を取る）
  - 進行中ターン（`task_complete` 無し）→ 直前の完了ターンにフォールバック
  - ターンが1つも無い / 空ファイル / 壊れた行混在
  - assistant がツールのみで prose 無し
- `test_handoff_text.ts` — 上限ちょうど / 超過 / prompt も reply も null / 改行を含む本文

Codex 側のフィクスチャは実ログの構造をなぞった最小 JSONL を `test/fixtures/` に置く（実ログそのものは個人情報を含むので使わない）。

## 確認事項

- 進行中ターンは rollout に未書き込み（#254）。「直前の**完了**ターンを渡す」が仕様であることを UI 文言でも示す
- 抜粋の上限値は暫定で置き、実運用で調整する
