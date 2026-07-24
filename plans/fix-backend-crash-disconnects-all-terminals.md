# fix — バックエンドの未捕捉例外でプロセスが死に、全ターミナルが切断される

対象: 実行中に突然すべてのターミナルがサーバから切断され、サーバコンソールに
`[vite] ws proxy error` / `[vite] http proxy error` + `AggregateError [ECONNREFUSED]`
が数秒おきに出続ける現象。

## 症状（ユーザ報告のログ）

```
[vite] ws proxy error:
[vite] AggregateError [ECONNREFUSED]:
    at internalConnectMultiple (node:net:1134:18)
    at afterConnectMultiple (node:net:1715:7)
[vite] http proxy error: /api/git-status?cwd=%2FUsers%2Fsatoshi%2Fmulmoclaude
[vite] AggregateError [ECONNREFUSED]: ...
```

## 分析（何が起きているか）

構成: `yarn dev` は `concurrently` で 2 プロセスを起動する（`package.json`）。

- **vite**（`CLIENT_PORT` = 6856）: 単なるプロキシ。`/ws`・`/ws/pubsub`・`/api`・`/artifacts`
  をすべて **バックエンド（`BACKEND_PORT` = 34567）** へ転送する（`vite.config.ts` の `server.proxy`）。
- **server**（Express, 34567, `server/index.ts:453` の `server.listen(PORT)`）: 実体。
  ターミナルの WebSocket も `/api` ポーリングもここに集約される。

`ECONNREFUSED` は「34567 で誰も listen していない」＝**バックエンドプロセスが落ちた**ことを意味する。
per-terminal の問題ではない証拠に、素の `/api/git-status` すら ECONNREFUSED になっている。
バックエンドが死ぬと、全ターミナルの WebSocket が同時に切れ、クライアントが再接続を試みるたびに
vite が上記エラーを吐き続ける → ユーザ視点では「全ターミナルが一斉に切断」。

**なぜ復帰しないか**: dev スクリプトは `node --watch` でバックエンドを動かしている。
`node --watch` は**ファイル変更**では再起動するが、**クラッシュ（未捕捉例外での exit）では再起動しない**
（"Completed running" を表示して待機するだけ）。だからファイルを保存するまで死んだまま = 切断が継続する。

**根本原因**: `server/` に `process.on("uncaughtException")` / `process.on("unhandledRejection")`
のトップレベルガードが**一切ない**（grep 済み）。したがって、バックエンドのどこかで発生した
1 個の未捕捉エラー（下記いずれか）だけで Express プロセス全体が落ち、全ターミナルを道連れにする。

- `server.on("error")` は既に存在するが、これは**bind 失敗（ポート使用中）専用**のガード
  （`server/index.ts:447`, `serverErrorExit`）。ランタイムの未捕捉例外はカバーしていない。

**最も疑わしい発生源（PTY/ソケット系）**: node-pty で多数の子プロセスを spawn している
（`server/session/pty-spawn.ts` の `spawnPty` / `spawnSandboxEntry`、
`spawn-claude.ts` / `spawn-codex.ts` / `spawn-shell.ts`）。
リスナ不在の `'error'` イベント（子プロセス・ソケットの EPIPE/ECONNRESET 等）や、
WebSocket ハンドラ内の reject された Promise は、いずれもプロセスを即死させる。
`[[shell-npm-prefix-bug]]`（spawnPty が環境によって失敗しうる件）も候補。

## 修正方針

2 段階。まず「1 個の不良イベントで全ターミナルが落ちる崖」を止め、同時に**真の原因のスタックを捕捉**する。

### Step A（先行・最小）— トップレベルガードで即死を止め、原因を可視化

`server/index.ts` に以下を追加:

```ts
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
});
```

- 目的: (1) 未捕捉エラーでプロセスを殺さず、全ターミナル切断の崖を防ぐ。
  (2) **本当のスタックトレース**をサーバペインにフルで残し、根本原因（Step B）を特定する。
- 注意: `bind failure`（`server.on("error")` → `process.exit`）は従来どおり即終了させる。
  こちらは正しく落ちるべきケースなので `uncaughtException` ハンドラでは握り潰さない
  （`server.on("error")` が先に exit するため衝突しない）。
- 方針判断: uncaughtException 後にプロセスを継続させるのは Node 的にはグレー（状態が壊れている
  可能性）。ただし本アプリは「全ターミナルの巻き添え死」より「1 セッションの不整合」の方が遥かにマシ
  なので、まずは**ログして継続**を採用。将来 supervisor（クラッシュ時に再起動する `node --watch`
  ラッパ / nodemon）導入時に fail-fast へ切り替える余地は残す。

### Step B（根本原因の第一候補）— WebSocket ソケットの `'error'` 未リスナを塞ぐ ✅ 本 PR で実施

grep の結果、`server/routes/ws-routes.ts` の**どの ws 接続にも `ws.on("error")` が無い**ことが判明。
`ws` ライブラリでは、リスナ不在の socket が `'error'` を emit すると Node がそれを再送出し
→ 未捕捉 → **プロセス全体がクラッシュ**する。クライアントのネットワークがセッション途中で切れると
socket は `ECONNRESET`/`EPIPE` を `'error'` として emit するため、これが症状に極めて良く一致する。

修正: `handleUpgrade` のコールバック（claude/run/launch/codex の**全 4 サーバが通る唯一の choke
point**）で、connection ハンドラ実行前に `attachSocketErrorLogger(ws, kind)` を配線。単体テスト可能な
よう小関数として export（`beginRunTerminal` と同じ流儀）。これで 1 クライアントの切断が 1 クライアントの
切断で収まり、全ターミナルを道連れにしない。

将来 Step A のログで別の発生源（PTY 系等）が判明したら、そこも同様に塞ぐ。

## 切り分け手順（次回発生時 / 再現時）

1. **今は原因スタックが見えていない**: ユーザが貼ったのは `concurrently` の **vite ペイン（緑）**。
   バックエンドの本当のスタックは **server ペイン（青）** の ECONNREFUSED ストーム直前に 1 回だけ出る。
   まずそこをスクロールして確認。
2. Step A を入れれば、以後はプロセスが生き残り、そのスタックが確実にログに残る。

## テスト（実装済み）

- `test/server/infra/process-guards.spec.ts`: (1) install で各イベントにハンドラが 1 個ずつ登録される
  (2) 冪等（2 回呼んでも増えない）(3) ハンドラ実行が throw せず `console.error` にスタックを出す
  ＝プロセスが生存する、を検証。
- `test/server/routes/ws-socket-error.spec.ts`: bare `EventEmitter` に `'error'` を emit すると
  （リスナ無しでは）throw することをまず確認し、`attachSocketErrorLogger` 適用後は同じ emit が
  吸収されて警告ログのみになることを検証（変異テスト的に「無ければ死ぬ／有れば生きる」を担保）。

### Step C（決定打）— dev バックエンドをクラッシュ時に自動再起動する supervisor ✅ 追加 PR

**Step A/B マージ後も再発**。調査の結果:

- 落ちた瞬間、mulmoterminal の dev プロセス（`concurrently` / `node --watch` の親 / vite）は**生存**、
  だが **34567 を listen しているものが無い**。＝`index.ts` の子が**ブート中にクラッシュ**して
  `node --watch` が idle 待機している状態。
- 同一コードを手で直接ブートすると**正常に listen する**。＝クラッシュは**間欠的**で、しかも
  Step A のガードを**すり抜けている**。ガードは install 後の runtime 例外しか捕えないので、
  すり抜ける＝**import 時エラー**（ガード登録前）か **明示 `process.exit`**（例: 再起動時に前インスタンスが
  まだ 34567 を握っていて EADDRINUSE → `serverErrorExit` → `process.exit`）。
- 実測で確定: `node --watch` は**クラッシュでは再起動しない**（"Failed running... Waiting for file
  changes" と表示して待つだけ）。これが「切断されたまま二度と戻らない」の正体。

根本原因（間欠クラッシュそのもの）は再現できていないが、**症状の決定打**はこの「再起動しない」性質。
`scripts/dev-server.mjs`（supervisor）で `node --watch` を置換:

- **どんな exit でも**バックエンドを再起動（fast-crash はバックオフ、通常は即）。import 時エラーでも
  `process.exit`（EADDRINUSE レース）でも自己回復する。tmux 永続化のおかげで再起動後は全ターミナルが
  透過再アタッチされ、切断は「恒久」から「一瞬」になる。
- ソース変更でも再起動（`node --watch` の役割を継続）。`node --watch` は元々変更ごとにプロセス全体を
  再実行するだけなので、full-restart 化してもコストはほぼ同じ。
- stdio inherit なのでクラッシュのスタックは server ペインにそのまま出る＋ `[dev-server] backend
  exited (...)` 行で可視化。次に落ちても自己回復しつつ原因ログが残る。

テスト: `test/scripts/dev-server.spec.ts` — stub エントリ（ブートで pid を追記して即クラッシュ）を
supervisor に食わせ、2 回目のブートが起きる（＝再起動した）ことをポーリングで検証。
`DEV_SERVER_ENTRY` / `DEV_SERVER_WATCH` env override はこのテスト専用フック。

## 未確定事項 / フォローアップ

- 間欠クラッシュの実スタック: supervisor 化で自己回復するようになったので緊急度は下がったが、
  次回発生時に server ペインの `[dev-server] backend exited` 直前のスタックで発生源を確定する。
  第一候補は import 時エラー か 再起動レースの EADDRINUSE。
- fail-fast（log→exit→supervisor 再起動）にすべきか、log→継続のままにするか。supervisor が入った今、
  fail-fast でも自己回復するので選択肢が広がった。まずは現状（ガードは継続、supervisor が再起動）で運用。
