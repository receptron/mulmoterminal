# fix: xterm がクリップボード(OSC 52)を処理せず端末のコピーが効かない

Issue: #204

## User Prompt

> single viewでxtermの文字をコピペしようと思ったらできなかった。grid viewは確かめてない。原因わかる？

## 原因（実機再現で確定）

Claude Code は選択テキストを **OSC 52**（クリップボード書き込みエスケープ）で自動コピーする（TUI に
`copied N chars to clipboard · disable auto-copy in /config` と表示）。mulmoterminal の xterm.js は
**`@xterm/addon-clipboard` を未ロード**で OSC 52 を無視するため、Claude Code は「コピーした」と表示するのに
ブラウザのクリップボードには何も入らない。single / grid 両方同構成。

- puppeteer 再現：選択はハイライトされるが Cmd+C 後もクリップボード空（`clipboardLen: 0`）。
- Claude Code はマウストラッキングモード → ドラッグは Claude Code 側の選択に消費され、xterm 側 native
  選択が無いので素の Cmd+C でもコピーされない。

## 修正

- `@xterm/addon-clipboard`（v0.2.0）を `yarn add`。
- `src/composables/useTerminalConnections.ts` の xterm 生成時に `term.loadAddon(new ClipboardAddon(undefined, clipboardProvider))`。

**要点（実装で判明）**: Claude Code は OSC 52 を **空セレクタ**で送る（`ESC ] 52 ; ; <base64>`）。
addon の既定 `BrowserClipboardProvider` は **`selection !== "c"` だと書き込まない**ため、空セレクタが落ちる。
そこで **空（と `c`）をシステムクリップボード扱いにするカスタム `IClipboardProvider`** を渡す
（`isSystemClipboard(selection)` = `"" || "c"`）。これで OSC 52 → `navigator.clipboard.writeText` に渡り、
Claude Code の自動コピーが実際にクリップボードへ入る（`localhost` は secure context のため利用可）。single / grid 両方に効く。

## 検証

- puppeteer：端末で選択（Claude Code 自動コピー）後に `navigator.clipboard.readText()` が非空になること。
- `yarn format` / `lint` / `typecheck` / `build` / `test`。

## メモ

- 主因は OSC 52。マウスモードOFFの素シェルで Cmd+C も効かせたい場合は別途 `attachCustomKeyEventHandler` で
  xterm 選択をコピーする配線も可能だが、本 issue の症状（Claude Code のコピー）はアドオン導入で解決する。
- OSC 52 は端末プログラムがクリップボードへ書ける経路。ここでは Claude Code を信頼する前提で許可。
