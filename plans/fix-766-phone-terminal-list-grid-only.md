# fix: 電話（mulmoserver）の端末一覧を grid セッションのみに絞る (#766)

## 原因

RemoteHost 経由でスマホへ送る端末一覧は `server/index.ts` の
`remoteHostListTerminalSessions` → `buildSessionList()`
（`server/backends/remoteHost/terminalScreen.ts`）で作られる。ここは live な pty 全部 +
tmux 全部を `isResumable` と「title あり or live」だけで絞っており、**grid セッション集合に
よる絞り込みが無い**。そのため単一ビュー(chat)セッションや、grid セルでない tmux 常駐シェルまで
電話に出ていた。

「grid view のものだけに絞る」変更を入れたつもりだったが、全 ref・stash・reflog を探しても
存在せず＝未実装だった（`remoteHostListTerminalSessions` は初出の #435 以降触られていない）。

grid セル（`gui=0`）は生成時に `markDevTerminalSession()`（`server/session/registry.ts`）で
`devTerminalSessions` 集合に登録され、ディスク永続＋ハイドレートされる（元は chat サイドバーから
grid を隠す用途）。この集合を intersect すれば grid のみに絞れる。

## 修正

1. **`buildSessionList` に純粋述語 `isGridSession: (id) => boolean` を追加**し、id を
   `.filter(isResumable).filter(isGridSession)` で絞る（規則は純粋関数側に置き、テスト可能に）。
2. **呼び出し側（`server/index.ts`）で `isGridSession: (id) => devTerminalSessions.has(id)` を
   渡す**。`resumableSessionPredicate()` が既に `devTerminalSessionsHydrated` を await 済みなので、
   `buildSessionList` 実行時点で集合はハイドレート済み（追加 await 不要）。

## 効果

電話の端末一覧は **grid セルのみ**。単一ビュー(chat)セッション・grid でない tmux シェル・
内部ワーカーは除外される（それらが live/resumable でも出さない）。

## テスト

`test/server/backends/remoteHost/terminalScreen.spec.ts` に 2 ケース追加：

- live だが grid でないセッションを落とす（chat を除外）。
- tmux のみで生き残った grid セッションは残し、隣の非 grid tmux シェルは落とす（再起動後も
  永続集合が名前を保つ）。

ミューテーション確認：`.filter(isGridSession)` を外すと上記 2 ケースが赤くなることを検証済み。

## 非対象

- grid の resume picker（#724 で revert 済み）や chat サイドバーの隠蔽（既存動作）には触れない。
- mulmoserver（別リポの PWA）側は変更しない。送信元で絞るのが確実。
