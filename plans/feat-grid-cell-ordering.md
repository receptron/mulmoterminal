# feat: グリッド表示のターミナル並べ替え（手動／自動）

## User Prompt

> grid表示のときにterminalの順番をかえたい。手動モードだと左右をいれかえ、自動モードだと、集中べきもの（完了したもの）を先に、その次はあいているもの、最後に動作中ものかな。動作中でもユーザのinteractionになったものは前に。

（クラリファイ後の確定事項）

- 手動モードの並べ替え操作 … 各セルヘッダの ◀ ▶ ボタンで隣と入れ替え
- 自動モードの再整列タイミング … 安定優先（status 変化が起きたときだけ整列。同じバケット内は元の手動順を保持する stable sort）
- モード切替 UI … ツールバーに Auto/Manual トグル。初期値は **手動**（既存ユーザのグリッドが勝手に並び替わらない）
- 並べ替えのスコープ … **全ページ横断**（10 個以上でも要対応セルが先頭ページへ浮く）

## 背景・現状

- グリッドは 1 本のフラットな順序付き `Cell[]`（`src/components/gridTabs.ts`）で、9 個ずつページ分割。並べ替え機能は無く挿入順固定。
- ターミナルのステータスはサーバが `working` / `waiting` の 2 フラグで管理し、`sessions` pub/sub で配信。
  各 `TerminalCell` が購読して `status = waiting ? "waiting" : working ? "working" : "idle"` を算出している。
- `CommandCell`（script 実行セル）は実行中=working 相当、終了=idle 相当（`finished` フラグ）。

ステータスとユーザ表現の対応：

| ユーザの言葉 | 内部 status |
| --- | --- |
| 集中すべき／完了した／ユーザの interaction になった | `waiting`（要対応） |
| あいている | `idle` |
| 動作中 | `working` |

→ 自動モードの並び順：**waiting → idle → working → 空ランチャー（末尾）**

## 設計

### 1. `gridTabs.ts`（純粋ロジック）

- `SortMode = "manual" | "auto"`、`CellStatus = "waiting" | "working" | "idle"` を追加。
- `GridState` に `sortMode: SortMode` を追加（全コンストラクタ／パーサで既定 `"manual"`）。
- `setSortMode(state, mode)`。
- `moveCell(state, uid, dir: -1 | 1)` … フラット配列内で隣と swap。両端・末尾の空ランチャーを越える移動は no-op。
- `orderCells(cells, statusByUid, mode)` … manual は恒等、auto は rank（waiting=0, idle=1, working=2, 空ランチャー=3）で **stable sort**（同 rank は元の index を保持）。
- `visibleOrdered(state, statusByUid)` … auto は **全件 `orderCells` → ページスライス**（zoom 中は全件）。manual は base 順スライス。
- `parseGridState` / `migrateLegacy` / 初期生成で `sortMode` を検証・付与。

並べ替えは **表示順のみ**。`cancelableLaunchUid` / `addCell` / ページ数などは base `state.cells` を見るので不変。

### 0. ステータスの解決（全ページ横断のため）

未マウントの他ページのセルも正しい status が要る（emit ベースだけだと off-screen が idle 誤認 → 誤ソート＆チャーン）。そこでサーバ権威の `useSessions()`（全セッションの working/waiting）を **第一ソース（session id キー）**、各セルの emit `statusByUid`（uid キー）を **フォールバック**（コマンドセル＝session id 無し、id 未割当の起動直後）として GridView で `statusForSort` にマージする。status は server truth なのでマウント状態に依存せず、ページ跨ぎでもフィードバックループが起きない。

### 2. コンポーネント

- `TerminalCell.vue` … 任意 prop `reorderable`、emit `move(dir)` / `status(CellStatus)`。
  ヘッダ actions に ◀ ▶ を追加（`reorderable` 時のみ）。`status` は `watch(status, …, { immediate:true })` で送出。
- `CommandCell.vue` … 同様に `reorderable` / `move` / `status`。status は running→working, finished→idle。
- `TerminalGrid.vue` … 任意 prop `reorderable` を各セルへ中継し、`move` / `status` を uid 付きで再 emit。
- `GridView.vue` …
  - `useSessions()` の session 状態 ＋ `@status` 由来の `statusByUid` を `statusForSort` にマージ。
  - `displayCells = visibleOrdered(state, statusForSort)`。
  - `onMove(uid, dir)` → `moveCell`、`toggleSortMode()` → `setSortMode`。
  - ツールバーに Auto/Manual トグル。`reorderable = sortMode === "manual"` を TerminalGrid へ。

`sortMode` は `GridState` の一部なので既存の deep-watch 永続化に自動で乗る。`statusByUid` はライブ状態なので永続化しない。

### 3. テスト

- `gridTabs.spec.ts` … `setSortMode` / `moveCell`（端・空ランチャー境界）/ `orderCells`（バケット順・stable・manual 恒等）/ `sortMode` の既定とパース。
- `TerminalGrid.spec.ts` … `reorderable` の中継、`move` / `status` の uid 付き再 emit。

## 留意点

- 自動モードは status 変化で再計算されるが stable sort なので同バケット内の手動順は保持。要対応が出たら前方へ寄る。
- 全ページ横断ソートのため、要対応セルがページを跨いで先頭ページへ移ると、押し出されたセルは別ページへ移動しマウント/アンマウント＝PTY 再接続が起きる（既存のページ切替と同じ挙動。背景 PTY は生存しスクロールバックは復元される）。stable sort なので跨ぎは最小限。
- i18n：本リポジトリのツールバーはハードコード英語のため、それに合わせる（vue-i18n は未導入）。

## ゲート

`yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / `yarn test`
