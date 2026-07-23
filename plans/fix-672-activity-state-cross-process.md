# fix #672 — activity-state.json の丸ごと書き出しが別インスタンスの waiting/working を消す

対象 issue: https://github.com/receptron/mulmoterminal/issues/672
関連: #620(別ファミリー欄)、#635(同型の dev-terminal 修正)

## 問題

`persistActivityState`(`server/session/registry.ts`)は、メモリ上の `activity` マップ全体のスナップショットを共有ファイル `MULMOTERMINAL_HOME/activity-state.json` に `fs.writeFile` で**丸ごと上書き**していた。このパスは PORT にもワークスペースにもスコープされておらず、同一マシンの全インスタンスが共有する（直列化はプロセス内のみ）。

`--port` を分けた 2 インスタンスが同じ `MULMOTERMINAL_HOME` を共有すると:

1. A が a1(working)を書く → `{a1}`
2. B が起動時に a1 を hydrate し、b1(waiting)を書く → `{a1, b1}`
3. A の a1 が idle 化 → A は自分のマップ `{}` を書き **b1 を消す**
4. 逆に A は hydrate した b1 を持ち続け、persist の度に **stale な b1 を復活**させる ping-pong

`waiting` は自己修正しない（Claude はプロンプト待ち中に Notification を再発火しない）ため、消えると再起動後にユーザが入力待ちセッションに気付けない。

append ログ化(#635 方式)は working/waiting が可変値なので不可（消えた状態を union で復活させてはいけない）。

## 修正

**「自分が所有しない session id を書かない/消さない」**を徹底する read-merge-write に変更。

- `ownedActivityIds: Set<string>` を追加し、`setFlag`(lifecycle.ts)で `activity.set` するたびに `claimActivityOwnership(id)` で所有を記録。所有は `ptys` からの導出ではなくフラグ時に記録するので、**reap 済み（pty は既に消えた）own セッションも自分のものと認識して削除できる**。
- `persistActivityState` は書き込み時にディスクを読み直し、pure 関数 `mergeOwnedActivity(onDisk, owned, isOwned)` で「own は自分の snapshot（idle は削除）、foreign はディスクのまま保持」を合成して書く。
- hydration は変更なし（foreign id は `activity` に入るが `ownedActivityIds` には入らないので、persist で自分のメモリからは書き戻さない）。

## テスト

`test/server/session/activity-state.spec.ts` に `mergeOwnedActivity` の直接テストを追加:

- own を書き foreign を保持 / own が idle でも foreign を落とさない / reap 済み own をディスクの stale ごと削除 / own をディスクから復活させない（自分が権威）/ own が無いとき foreign を丸ごと保持

ディスク保持を外す変異で 3 件が赤・入れると緑を確認済み。合成規則(判断)を pure 関数に出し、read/write の I/O は registry 側に残した（config-routes の read-merge-write と同じ形）。
