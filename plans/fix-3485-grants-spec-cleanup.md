# fix #3485: codex-session-grants.spec の後片付けが書き込みと競合する

`rememberGrants` の追記は `persist` の連鎖に積まれるだけで、呼び出し側は待たない。書き込みを待たずに終わるテストのあと、`afterEach` の `rm(home, { recursive: true })` と遅れて届く `mkdir` / `appendFile` が重なり、`ENOTEMPTY` で落ちる。

## 変更

- `afterEach` で `whenSessionStatePersisted()` を待ってから `rm` する。テストだけの変更で、本体は触らない。

## 確認

- spec を繰り返し実行して緑。
- `afterEach` の待ちを外すと、遅延を足した場合に再現することを確かめる。
