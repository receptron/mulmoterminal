# feat #174: エージェント状態の細分化（blocked / done / working / idle）

## User Prompt
> 174/175は比較的簡単にできると思うので、すすめて。

（Issue #174）`waiting` が「承認・入力待ち」と「完了して未レビュー」を混同している。両者を分離して色分け＋Auto並べ替えの優先度を精緻化する。

## 背景（実コード）
- サーバは Claude hook から状態を導出: `UserPromptSubmit→working`、`Stop→waiting(完了未読)`、`Notification→waiting(承認/入力待ち)`。
- どのイベントで waiting になったかは `activity.event` に記録され、**pub/sub では既に配信済み**（`publishActivity`）。REST（`/api/sessions`・`/api/session/:id`）には未載。
- つまり **サーバの状態ロジックは変えない**。`event`（生の Stop/Notification）を REST にも通し、クライアントで意味付けする＝低リスク。

## 状態マッピング（クライアント）
```
waiting && event === "Notification" → "blocked" (承認/入力待ち・最優先)
waiting (それ以外, 実質 Stop)        → "done"    (完了・未レビュー)
working                              → "working"
それ以外                             → "idle"
```
Auto並べ替え優先度: `blocked(0) > done(1) > idle(2) > working(3)`、空ランチャー(4)。

## 変更
### サーバ `server/index.ts`（`event` を REST に通すだけ）
- `SessionMeta` に `event: string | null` を追加。
- `readSessionMeta` の返り値に `event: a?.event ?? null`。
- pending セッション object と `/api/sessions` の pending 直列化に `event`。
- `/api/session/:id` 応答に `event: a.event ?? null`。

### クライアント
- `gridTabs.ts`: `CellStatus = "blocked" | "done" | "working" | "idle"`、`RANK` 更新、純粋関数 `activityStatus(working, waiting, event)` を追加（TerminalCell と GridView で共用）。
- `useSessions.ts`: `Session.event?: string | null`。
- `TerminalCell.vue`: `event` を購読/保持し、`activityStatus` で status 算出。`is-waiting` → `is-blocked` / `is-done` に分割（枠色・ドット・ヘッダー tint・ラベル）。
- `GridView.vue`: `toStatus` を `activityStatus` に置換、`sessionStatus` も event 込みで算出。
- `CommandCell.vue`: 変更なし（working/idle のまま、CellStatus に含まれる）。

### 色/ラベル
- blocked: 琥珀＋glow（従来の is-waiting）/「Needs input」
- done: 青（静的、脈動なし）/「Done — review」
- working: accent 青・脈動（従来）/「Working…」
- idle: dim（従来）/「Idle」

## テスト
- `gridTabs.spec.ts`: `activityStatus`（4分岐）、`orderCells`（新RANK: blocked→done→idle→working）。
- `TerminalCell.spec.ts`: pub/sub で event=Notification→blocked, event=Stop→done, working, idle のクラス/ラベル。

## ゲート
format / lint / typecheck / build / test
