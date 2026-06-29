# Plan: グリッドをタブ（ページ）で複数面化 — 1配列モデル

Issue: #83（#46 の req7）
作成日: 2026-06-21

## モデル（確定）
**ターミナルは1つのフラットな配列 `cells`。タブはメタデータ（ページ）** — 9個ごとのページ＝タブ。
- 端末は配列の末尾に追加。**満杯で「＋Terminal」を押すと新ページ（タブ）に溢れる**。
- **端末を閉じると配列全体が前詰めされ、後続ページの端末が前のページへ流れ込む**（タブ跨ぎの繰り上げ）。
- 末尾の空き起動セルは1つだけ。空グリッドは入口の起動セル1つ。
- タブバーはページが2つ以上のときだけ表示。完全自動（手動の＋タブ/✕無し）。
- アクティブページのみマウント。他ページの端末はサーバ側 PTY で生存→再表示で再接続/resume。

## 永続化
- 単一キー `grid_v2` = `{ cells:[{uid,session,cwd}], expanded:uid|null, page, nextUid }`。
- 旧 `grid_state_v1`（単一グリッド）を初回に1配列へ移行（移行後に旧キー削除）。

## 実装
### `gridTabs.ts`（純関数・テスト可能 — 状態の単一ソース）
- 型 `Cell` / `GridState`、定数 `PAGE_SIZE=9` / `MAX_TERMINALS=81` / `STATE_KEY` / `LEGACY_KEY`。
- 導出: `pageCount` / `pageSlice` / `runningCount`。
- ミューテーション（GridState→GridState）: `addCell`（追加/溢れ/キャンセル）・`setSession`・`setCwd`・`closeCell`（削除＋前詰め＋entry保持＋page clamp）・`toggleExpand`・`switchPage`（末尾空きセル除去＋zoomクリア）。
- 復元/移行: `parseGridState` / `migrateLegacy` / `initialState`。

### `TerminalGrid.vue`（制御コンポーネント＝1ページを描くだけ）
- props `cells`（ページのスライス）/ `expanded-uid` / dir系。emits `session/cwd/close/toggle-expand`（uid付き）。
- `layoutForCount(cells.length)` で自動レイアウト＋ teleport zoom。状態・localStorage は持たない。

### `GridView.vue`（1つの `GridState` ref を所有）
- 純関数でミューテート、`pageCount`/`pageSlice` で導出、deep watch で永続化、初回移行。
- タブバー（>1）: 番号ページ、クリックで `switchPage`。「＋Terminal」= `addCell`。

## テスト
- `gridTabs.spec.ts`: ページング＋全ミューテーション＋前詰め（page2→page1）＋復元/移行。
- `TerminalGrid.spec.ts`: ページ描画・props透過・uid付き emit・zoom クラス。
- 計 209 tests / lint・typecheck・build 緑。

## スコープ外（別issue）
- req8: 裏タブの入力待ち/終了バッジ。
