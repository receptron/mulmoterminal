# fix: マルチビューの「new ターミナル」起動セルを閉じられるようにする

作成日: 2026-06-29

## User Prompt

- マルチビューのターミナルで、new ターミナルを起動しようとしてやめたいとき閉じれない。

## 現状（バグ）

- ツールバーの「＋ Terminal」を押すと、空の起動フォーム（`TerminalCell.vue` の `cell-launch`）を持つセルが追加される。
- この空セルには閉じる（✕）ボタンが無い。閉じる（✕）は `launched === true`（起動済み）のヘッダー内にしか描画されない。
- 唯一のキャンセル手段はツールバーの「＋ Terminal」を再度押すこと（`launchOpen` 時に `addCell()` が末尾の空セルを削除する仕様）だが、ボタンの見た目では分からず気付けない → 「やめたいのに閉じられない」。

## ゴール

空の「new ターミナル」起動セルに、その場で破棄できるキャンセル（✕）ボタンを追加する。
ただしグリッドが空のときの唯一の「エントリーセル」は閉じる対象にしない（ツールバーの挙動と一致）。

## 設計

### `gridTabs.ts`
- `cancelableLaunchUid(state): number | null` を追加。末尾セルが launch cell かつエントリーセル以外（`cells.length > 1`）のときその uid を返す純関数。エントリーセルは常に `null`。

### `GridView.vue`
- `cancelUid = computed(() => cancelableLaunchUid(state))` を導入し、重複していた `launchOpen` のインラインロジックを `launchOpen = cancelUid !== null` に整理。
- `:cancel-uid="cancelUid"` を `TerminalGrid` に渡す。

### `TerminalGrid.vue`
- `cancelUid: number | null` prop を受け取り、各 `TerminalCell` に `:cancellable="cell.uid === cancelUid"` を渡す。

### `TerminalCell.vue`
- `cancellable?: boolean` prop を追加（任意・既定 false）。
- `cell-launch` の先頭に、`v-if="cancellable"` の ✕ ボタンを追加。クリックで `close` を emit（親の `closeCell` がセルを削除）。
- セル右上にアンカーする `.cell-launch-cancel` スタイル（`.cell` が `position: relative` のため、フォームのスクロールに追従せず固定）。

## 注意点

- 空の起動セルにはまだセッション/worktree が無いため、`close()` の重い後始末は不要。✕ は単に親へ `close` を emit するだけにする。
- 末尾の launch cell は常に1つだけ（`addCell` は末尾が launch cell なら追加しない）なので、cancellable なセルは高々1つ。
- エントリーセル（`cells.length <= 1`）は ✕ を出さない＝ツールバーの「sole entry cell は cancel 不可」と一貫。

## 確認ポイント

- 「＋ Terminal」で追加した空セルに ✕ が出て、押すとセルが消えるか。
- グリッドが空（エントリーセルのみ）のときは ✕ が出ないか。
- 起動済みターミナル / コマンドセルでは従来どおりヘッダーの ✕ のみで、起動フォームの ✕ は出ないこと。
