# fix: peer チップが対話セッションではなく SDK の子の名前を出す（#3244）

## 背景

#3237 / #3241 で入れた `peer` チップは、Claude Code の登録簿 `<claude home>/sessions/<pid>.json` から、
セルの tmux セッションを名乗る項目のうち最後に書かれたものの名前を出す。

## 観測

実機で一つのセルだけ別の名前が出た。そのセルの中から起動されたプラグインの常駐プロセスが
`claude -p --input-format=stream-json` を複数起動しており、それらはセルの `TMUX_PANE` を引き継いで同じ
tmux 対象で登録されていた。登録簿の `entrypoint` は、対話セッションが `cli`、子が `sdk-cli`。子は待機中の
対話セッションより頻繁に項目を書き直すので、「最後に書かれたもの」の規則では子が勝つ。

## 方針

`entrypoint` が `cli` でも空でもない項目は、そのセルのものとして数えない。

- `cli`: 端末の中で人が打ち込む claude。セルのもの。
- 空（この欄を書かない版の Claude Code）: 従来どおり扱う。
- それ以外（`sdk-cli` など）: プログラムが動かしているセッション。セルの名前ではないので外す。
  外した結果だれも残らなければ名前は出ない。

「`cli` を優先し、無ければ従来の規則」にしなかった理由: 対話セッションが登録されていないセルで SDK の子の
名前を出すのは、人には見えないセッションを指すので誤り。空の項目を残すのは、欄を書かない版への後方互換。

## 変更

- `server/agents/claude/claude-peers.ts`: `ClaudePeer.entrypoint`、`parseClaudePeer` で読む、
  `INTERACTIVE_ENTRYPOINT`、`peerNameFor` で候補を絞る。
- `test/server/agents/claude/claude-peers.spec.ts`: 欄の読み取り、SDK の子がいくつあっても対話セッションを
  選ぶ、子だけなら無し、欄を書いていない項目は従来どおり。
- `test/server/routes/session-detail-peer.spec.ts`: 同じ tmux に `sdk-cli` の項目があっても経路が対話
  セッションの名前を返す。

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`。
実機では、この issue を観測したセルで `GET /api/session/<id>` の `peerName` が、そのセルの ListAgents が
「this session」として返す名前と一致すること。
