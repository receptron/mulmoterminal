# fix #671 — /ws/run が接続解決の await 中にソケットが閉じると孤児 PTY をリーク

対象 issue: https://github.com/receptron/mulmoterminal/issues/671

## 問題

`startRunTerminal`(`server/routes/ws-routes.ts`)は `await resolveRunTarget(url)` が解決した**後**にしか `ws.on("close", () => term.kill())` を配線しない。button 経路は `resolveButtonRun` → `buildHeaderContext(cwd)` が `git status` サブプロセスを await するため数十〜数百 ms の窓がある。この間にクライアントが離脱すると `close` イベントはリスナ不在のまま発火して消え、await 解決後に spawn した PTY は close 済みで二度と kill されない。`/ws/run` は ephemeral(reap/grace 対象外)なので、長命なボタンコマンド(`npm run dev` 等)だとサーバ終了まで孤児プロセスが残る。

claude ハンドラ(`handleClaudeConnection`)は同型の窓(Keychain refresh の await 後)を `ws.readyState !== ws.OPEN` で既にガードしている。run ハンドラにだけこのガードが無かった。

## 修正

`startRunTerminal` を「非同期 resolve」と、同期の `beginRunTerminal(deps, ws, resolved)`(**readyState ガード → spawn → message/close 配線**)に分割し、後者を export。resolve 後に `ws.readyState !== ws.OPEN` なら spawn せず return。claude 側と同じ判断。

## テスト

`test/server/routes/ws-run-terminal.spec.ts`(新規)で `beginRunTerminal` を注入 deps + fake ws で直接検証:

- ソケットが OPEN のとき spawn し、`close` で `term.kill()` される
- resolve 中に閉じた(readyState=CLOSED)ソケットでは **spawn しない**(リーク防止)

ガードを外すと後者が赤・入れると緑を変異テストで確認済み。
