# fix #342 — hot reload でターミナルが idle 扱いになる

## 症状
サーバ再起動（`--watch` hot reload）後、working / blocked / done だったセッションが全部 idle 表示になる。

## 根本原因（2つ）
1. **`working` を再起動で復元しない**（意図的設計。ターン完了を跨ぐ stuck を嫌って）。→ 実行中セッションが idle。
2. **`waiting`（blocked/done）も idle になるレース**：`waiting` は永続化・復元
   （`setWaiting`→`persistWaitingState`、`waitingStateHydrated`）されるが、読み取り側
   `/api/activity`・`/api/session`・`/api/sessions` が **hydration を await していない**。
   再接続後の再取得（`useGridActivity` の onReconnect → `/api/activity`）が復元完了前に走ると idle が返る。

## 修正
### `server/waiting-state.ts` → `server/activity-state.ts`（一般化）
- スナップショットを `Record<id, {working, waiting, event}>` に。`working || waiting` のセッションを保存
  （hidden 除外は不変）。`buildActivitySnapshot` / `parseActivityState`。

### `server/index.ts`
- `WAITING_STATE_FILE`→`ACTIVITY_STATE_FILE`（`activity-state.json`）、`waitingStateHydrated`→`activityStateHydrated`。
  hydration で working+waiting+event を復元。
- `setWorking` でも `persistActivityState()` を呼ぶ（working を永続化）。復元した working は次の Stop で自己補正。
- 読み取り 3 ルート `/api/activity`・`/api/session`・`/api/sessions` で先頭に `await activityStateHydrated`。

## 非スコープ
- restart 中にターンが完了して Stop が失われた稀な stuck-working（次の操作で解消）。
- working を PTY 生存で厳密検証する仕組み（今回は永続＋自己補正で十分）。

## テスト
- `server/activity-state.spec.ts`：build/parse（working+waiting、hidden 除外、非オブジェクト耐性）。
