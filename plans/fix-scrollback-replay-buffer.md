# fix: 再接続後のスクロールバックが ~100 行しか残らない（リプレイバッファ拡大）

## User Prompt

> terminalのスクロールで戻れる量ってへってない？過去ログをこぴぺしたいんだけど。
> 今100行くらいしかもどれない。1000行あれば良いと思うんけどバッファーの問題かな？

## 診断

- クライアント xterm の `scrollback` は xterm 既定の 1000 行（未設定）。
- ただしリロード/再接続時、`useTerminalConnections.ts` の `connect()` が `term.reset()` でバッファを消去し、
  サーバは `pty-connection.ts` で**リプレイバッファ全体（`OUTPUT_BUFFER_LIMIT = 64 KiB`）だけ**を送り直す。
- リプレイは PTY の**生バイト**（色・エスケープ・TUI 再描画込み）。Claude の出力は 64 KiB ≒ **約100行**にしか
  ならず、ユーザ観測と一致。→ 実質の上限は xterm ではなく**サーバのリプレイバッファ**。

## 修正

`server/index.ts` の `OUTPUT_BUFFER_LIMIT` を **64 KiB → 1 MiB** に拡大。
観測比（64 KiB≒100行）で 1 MiB ≒ 1500行以上。クライアント側 scrollback は 1000 行で頭打ちなので、
過剰分は自然に切れ、**再接続後も約1000行まで遡れる**ようになる。メモリ増はセッションあたり最大 1 MiB 程度。

- `appendBoundedOutput`（`terminal-replay.ts`）は `limit` を引数で受ける純関数のまま。定数だけ変更。
- 既存テストは明示 limit（100/5/6…）で検証しており 64 KiB をハードコードしていない → 影響なし。

## 検証

typecheck / build / terminal-replay テスト パス。
