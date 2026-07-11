# fix: グリッドの注目信号が届かない（#321）

Issue: #321 / Branch: `fix/grid-attention-signal`

## User Prompt

Zenn の cmux エコシステム記事を起点に「これから取り入れられる要素はあるか」を検討。輸入より、AIエージェント時代のターミナルとしての mulmoterminal 自身の弱点を洗い出す方が費用対効果が高い、という結論に至り、弱点を網羅調査。バグ的挙動だけ先に issue 化する方針で、①（表示中セルが注目信号を出せない）を起点に実測で確定させ、ファクトに基づいて issue と plan に落とす、という流れ。

## 概要

グリッドの注目信号（working / blocked / done）が、**最も監視したい状況ほど届かない**。原因は単一ビュー前提の状態設計（「ソケットが1本繋がっている＝人がそれを見ている」）で、グリッドでは3系統に破綻する。症状は別々だが根本は同一のバグ系統。

## 実測ファクト（実サーバに合成フックを撃って確認済み）

計測手順: `PORT=<free> CLAUDE_CWD=<scratch> node --import tsx server/index.ts` を起動し、`/ws?gui=0&cwd=` で grid dev-terminal セッションを作成、`/api/hook`（`x-mt-session` ヘッダ付き）で `UserPromptSubmit`/`Notification`/`Stop` を撃ち、`/api/session/:id`・`/api/sessions` で状態を観測。クライアントの表示は `gridTabs.ts` の `activityStatus(working, waiting, event)` の純関数で決まるためサーバ状態から一意に導ける。

### #1 表示中セルは blocked / done に入れない

| ケース | working | waiting | event | セル表示 |
|---|---|---|---|---|
| FG: UserPromptSubmit 後 | true | false | UserPromptSubmit | working |
| FG: Notification（承認待ち） | true | **false** | UserPromptSubmit | **working（「Working…」のまま）** |
| FG: Stop（完了） | false | **false** | Stop | **idle** |
| BG（対照）: 同じ Notification | false | **true** | Notification | **blocked（amber）** |

差分は「ソケット接続の有無」だけ。表示中セルは承認待ちでも「Working…」、完了しても idle。

### #2 別ページのセルは idle 固定

grid（`gui=0`）セッションは、接続中もブロック中(background)も unscoped `/api/sessions` に出てこない（ids count=0）。`GridView` は別ページ（未マウント）セルの状態をこの一覧から引くため idle 固定。

### #5 再起動で注目状態が消える

ブロック中セッションで再起動: 前 `waiting=true/event=Notification` → 後 `waiting=false/event=null`（idle 化＝信号消失）。Claude は既にプロンプト待機中で `Notification` を再発火しない。

## 症状 × 根本原因マトリクス

| # | 症状 | レイヤ | 根本原因 | 該当箇所 |
|---|---|---|---|---|
| #1 | 表示中セルが blocked/done を出せない | server | `foreground = !!(entry && entry.ws)`。`!foreground` ゲートで setWaiting 抑制＋attach時クリア | `server/index.ts:1081, 1006, 1010, 2125` |
| #2 | 別ページセルが idle 固定 | server+client | grid(dev-terminal) を unscoped `/api/sessions` から除外。GridView はそれを別ページ状態源に使う | `server/index.ts:1393`, `src/composables/useSessions.ts:77`, `src/components/GridView.vue:78-90` |
| #5 | 再起動で注目状態消失 | server | `activity` はメモリのみ。`/api/session`・`/api/sessions` とも `activity.get(id)` 依存 | `server/index.ts:456, 1257-1259, 1350-1352` |

## 設計判断（要・人間確認）

**グリッドで "今まさに見ているセル" も amber にするか？**
- 採用: **する**（既定で誰も active でない）。9枚の中で「これに対応して」を色で示すのがグリッドの価値。既読化はそのセルをズーム/オープンした時。
- 却下: 可視ページ全体を foreground 扱い → 画面内セルが結局光らず #1 が半分残る。

## 修正方針

### #1 — foreground を「注視中ペイン」に作り替える

- クライアント→サーバに view/active フレームを新設（`{type:"view", active:boolean}`）。`handleClientFrame`（`server/index.ts:1908`）で受けて `PtyEntry.active` を更新。
- `PtyEntry` に `active: boolean`（既定 false）を追加。
- `handleActivityHook`（`:1000`）: `foreground` 引数を「`entry.active`」ベースに変更（`!entry.active` で setWaiting）。
- attach 時の無条件 `setWaiting(false)`（`:2125`）を廃し、**active になった瞬間だけクリア**。
- クライアント: 単一ビューは開いているセッションを active に。グリッドは既定で全セル非 active、ズーム/オープンしたセルのみ active（`feat-click-header-to-zoom` の選択状態と接続）。

### #2 — grid セル状態を pubsub で別ページにも配信

- `GridView` の別ページ状態源を、フィルタ済み unscoped `/api/sessions` から **activity pubsub**（`SESSIONS_CHANNEL`、既に dev-terminal 遷移を配信）に切り替える。各セルの `session` id で購読し、`statusForSort` に反映。
- `GridView.vue:71-74` の「session list は全ページを覆う」コメントは誤りなので実装に合わせて修正/削除。
- 代替案: grid 用に dev-terminal を除外しない状態エンドポイントを新設（pubsub 案の方が軽く整合的なので第一候補）。

### #5 — activity をディスク永続＋起動時 rehydrate

- `activity`（working/waiting/event/at）を tool-calls ストア（`~/.mulmoterminal`）と同様に永続化し、起動時に rehydrate。
- 再アタッチ時、tmux 復帰セッションのプロンプト検出で blocked を再導出する保険も検討（③の出力スキャンと共通基盤）。

## 変更ファイル（想定）

- `server/index.ts`: `PtyEntry.active`、view フレーム処理、`handleActivityHook`/attach ゲート、activity 永続化＋rehydrate。
- `src/composables/useTerminalConnections.ts`（or 該当 ws 送信箇所）: active/blur 送信。
- `src/components/GridView.vue` / `TerminalCell.vue`: active 送出タイミング、別ページ状態を pubsub 由来に。
- `src/composables/useSessions.ts`: 必要に応じ grid 状態購読の分離。

## テスト（各ケースに回帰テスト）

- `server/index.spec.ts`（or 該当）: 
  - #1: active=true のセッションに Notification/Stop → waiting は立たない。active=false → 立つ。attach 単独では waiting クリアしない、view active でクリア。
  - #5: activity を永続 → 再起動相当（再 hydrate）で waiting/event が復元。
- `gridTabs.spec.ts`: 既存 activityStatus/orderCells は不変（サーバが状態を正しく出せば表示は既存ロジックで正しくなる）を確認。
- client: グリッドで別ページのブロックセルが pubsub 経由で blocked として集計される（#2）ユニット/結合テスト。

## ゲート

`yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`

## 補足（別issue想定・本issue対象外）

- Codex はフック非対応で注目/コストスタック全体から不可視（#254 関連）。
- `Notification` は permission/question/idle を混同（idle を blocked 誤検知）。PTY 出力スキャンの保険が無い。
- context 満杯警告なし／窓サイズ直書き、per-dir 設定の手編集非反映。
