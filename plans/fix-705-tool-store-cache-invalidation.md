# fix #705 — クロスプロセスで tool-store の read キャッシュが古くなる

対象 issue: https://github.com/receptron/mulmoterminal/issues/705（#620 から分離）

## 問題

`server/session/tool-store.ts` の `createSessionStore` は in-memory `Map` を一度ロードしたら再起動まで読み直さなかった。同一 `MULMOTERMINAL_HOME` を 2 サーバが共有する構成で、非所有サーバのUIで所有サーバのセッションのツール履歴を開くと、所有サーバの追記が反映されない（read の陳腐化・自己修復なし）。

## 設計判断

キャッシュを「所有」で分ける:
- **このインスタンスが save したセッションは所有**（`owned: Set`）。そのマップが真実で、**決して再読込しない**。save は fire-and-forget なので、再読込すると未フラッシュの in-place 変更を上書きしてしまう（実際、最初に試した mtime 単独ガードでは 55 回 push が 1 件に化ける lost-update レースが出た）。
- **read しかしていないセッション（他サーバ所有）**は、ファイルの mtime がキャッシュ時より新しければ `get` で再読込。

所有判定はプロセス内の store インスタンス単位で正しい: フック/ブローカーの URL に所有サーバのポートが焼き込まれているため、あるセッションの `save`（storeToolResult / recordToolCall*）は所有サーバでしか走らない。非所有サーバの store は同セッションを save しない。

`statMtimeMs` を引数注入にし、テストで mtime を決定的に駆動できるようにした。

## テスト

`test/server/session/tool-store.spec.ts` に 2 本追加:
- 非所有: 別インスタンスがファイルに追記 → mtime が進む → 次の `get` で再読込して新内容を返す。変化なしなら再読込しない。
- 所有: `save` 後の `get` は同じ working array を返す（自分の書き込みを再読込しない）。

変異テスト2件で確認済み:
1. 再読込を消すと非所有テストが赤（陳腐化解消のコア）。
2. 所有の短絡を消すと「cap 50」テストが赤（lost-update レースが再発）。

既存 22 テスト（同一 array 契約・concurrent load dedup・corrupt→[]・traversal 拒否）は不変で緑。
