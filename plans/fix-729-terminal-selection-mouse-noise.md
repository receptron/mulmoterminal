# fix #729 — 範囲選択でマウス報告のノイズが入力欄に出る

## 症状

ターミナルで文字をドラッグ選択すると、入力欄に ASCII のランダムな文字列が出る。入力すると
消えるのでバッファは壊れないが、選択・コピーのたびに毎回出る。

## 根本原因

Claude Code の TUI がマウストラッキング（`CSI ? 1000/1002/1003 h`）を有効化する。その状態の
ドラッグを xterm.js はマウス座標のエスケープシーケンス（SGR `\e[<0;12;5M` …）に変換して PTY へ
送るため、Claude の入力行に文字として表示される。

加えて xterm.js v6 の選択バイパスは macOS だけ条件が違う:

```js
shouldForceSelection(e) {
  return isMac ? e.altKey && rawOptions.macOptionClickForcesSelection : e.shiftKey
}
```

本リポジトリは `macOptionClickForcesSelection` を設定していない（既定 false）ので、**macOS には
回避手段が存在しない**（Shift も Option も効かない）。

## 修正

1. `src/composables/mouseTrackingModes.ts`（新規・純関数）
   `swallowsMouseTracking(params)`: DECSET/DECRST のパラメータが**すべて**マウス関連モード
   （1000/1001/1002/1003 のトラッキング、1005/1006/1015/1016 のエンコーディング）なら true。

   **全部が対象のときだけ握りつぶす**のが要点。`CSI ? 25 ; 1002 h` のように無関係なモード
   （25 = カーソル表示）が混ざったシーケンスを丸ごと握りつぶすと、そちらの効果まで消えてしまう。
   混在時は通す（マウスが有効化されるが、他モードを壊すよりはるかに安全）。
   エンコーディングを対象に含めるのは `CSI ? 1002 ; 1006 h` を 1 シーケンスで送るアプリのため
   （含めないと「全部が対象」に一致せず 1002 が通ってしまう）。

2. `useTerminalConnections.ts`
   `term.parser.registerCsiHandler({ prefix: "?", final: "h" | "l" }, …)` でそれらを握りつぶす。
   xterm がマウスモードに入らないので素のドラッグで範囲選択できる。ハンドラは
   `term.dispose()` で一緒に破棄される。
   併せて `macOptionClickForcesSelection: true` も設定（混在シーケンスなどでモードが有効化された
   場合の逃げ道＝macOS の Option+ドラッグ）。

## 挙動

- 素のドラッグで範囲選択（ノイズなし）
- ホイールは xterm 自身のスクロールバック（ブラウザ端末として自然）
- **代償（合意済み）**: セル内の vim / lazygit / htop 等でマウス操作が効かない

## テスト

`test/src/composables/mouseTrackingModes.spec.ts`:
トラッキング各モード / エンコーディング / 複合（1002;1006）は握りつぶす、無関係モード
（25, 2004, 1049 など）と混在シーケンスは通す、空パラメータは通す。
