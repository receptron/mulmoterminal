# fix #263 — ターミナルで Shift+Enter による改行

## 原因
`useTerminalConnections.ts` の `term.onData` は xterm の生成バイト列をそのまま PTY に送る。
xterm は Enter も Shift+Enter も `\r` を送るため区別できず、どちらも送信になる。

## 修正
`term.attachCustomKeyEventHandler` で Shift+Enter（keydown）を横取りし、改行シーケンスを
PTY に直接送って xterm 既定の `\r` を抑止（`return false`）。判定は純関数
`shiftEnterNewline(e)` に切り出してテスト。

## 送るシーケンス（要ライブ検証）
第一候補 `NEWLINE_SEQUENCE = "\x1b\r"`（Meta/Alt+Enter ＝ claude の改行）。
実 claude で改行が入らなければ `\n` / CSI-u `\x1b[13;2u` を試す（定数1つの差し替え）。

## 非スコープ
- Option/Alt+Enter のマップ（必要なら追加）
- kitty/modifyOtherKeys の有効化
