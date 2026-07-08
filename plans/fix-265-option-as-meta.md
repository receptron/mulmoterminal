# fix #265 — macOS Option を Meta として扱う

## 決定
ユーザー判断「é（Option アクセント入力）は不要」→ `macOptionIsMeta: true` を既定 on。

## 修正
`useTerminalConnections.ts` の `new Terminal({...})` に `macOptionIsMeta: true` を追加。
これで Option/Alt が Meta（ESC 前置）として PTY に届き、Claude の Alt バインドが有効化:
Alt+Enter（改行）/ Alt+B・F（単語移動）/ Alt+Backspace（単語削除）。

## トレードオフ
Option+文字のデッドキー（é 等）入力は無効化（コーディング/claude ターミナルでは不要）。

## テスト
mock で `new Terminal` に渡る options を捕捉し、`macOptionIsMeta === true` を検証。
