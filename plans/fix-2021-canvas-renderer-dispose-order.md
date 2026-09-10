# fix: canvas renderer を先に dispose する（#2021）

## 問題

ターミナルを破棄すると xterm が
`TypeError: Cannot read properties of undefined (reading 'onShowLinkUnderline')` を投げる。
検証中にコンソールで 4 回観測（コレクションペインの dock 切り替え / スプリッタ最大）。
当初は「大きなリサイズで間欠的に出るコンソールノイズ」に見えていた。

## 原因（コードで追った経路）

1. `@xterm/addon-canvas@0.7.0` は dispose されるとき、DOM renderer に戻すために
   `(terminal as any)._core._createRenderer()` を呼ぶ
   （`node_modules/@xterm/addon-canvas/src/CanvasAddon.ts:61-66`）。
2. xterm 6 の `_createRenderer()` は `this.linkifier!` を渡す
   （`CoreBrowserTerminal.ts:583-585`）。`linkifier` は `MutableDisposable` で
   （同 72-73 行）、**terminal 自身の dispose がすでに value を捨てている**。
3. `DomRenderer` のコンストラクタは `this._linkifier2.onShowLinkUnderline(...)` を購読する
   （`renderer/dom/DomRenderer.ts:89`）→ `undefined` を購読して throw。

つまり「**addon より先に terminal を dispose すると必ず落ちる**」という順序のバグ。
リサイズは引き金ではなく、リサイズ由来の `rebuildTerminal`（#846 の修復）が
`deadTerm.dispose()` を呼んでいたのが実体。

## これがコンソールノイズで済まない理由

`rebuildTerminal` は dispose を try/catch していなかったので、throw が抜けて**後続が実行されない**:

```ts
deadTerm.dispose();   // ← throw
connect(c);           // ← 実行されない = 新しい端末にソケットが無い
fitAndSyncSize(c);
if (hadFocus) term.focus();
```

「固まったセルを直す」ための修復が、**セルを恒久的に無反応にする**。
`release()` 側は try/catch があるので握り潰されていたが、terminal の dispose は
addon の disposable で止まるため、その後ろの後始末は走っていない。

## 測定（実ブラウザ・このアプリが積んでいるバージョンで）

esbuild で最小ページを作り、`@xterm/xterm@6.0.0` + `@xterm/addon-canvas@0.7.0` で 10 回ずつ:

| | throw |
|---|---|
| terminal を先に dispose（従来） | **10 / 10** |
| addon を先に dispose（本 PR） | **0 / 10** |

間欠的に見えていたのは引き金（rebuild）のほうで、順序さえ踏めば 100% 再現する。

## 直し方

`src/composables/terminalRenderer.ts` に canvas renderer の**ライフサイクル一式**を集約:

- `loadCanvasRenderer(term)` — 従来 `buildTerminal` にあった best-effort な読み込み。
- `disposeTerminal(term, renderer)` — **renderer を先に**、どちらが throw しても
  呼び出し側には投げない。呼び出し側には後始末（`connect`）が残っているため。

`Conn` が addon を保持するようにし、`rebuildTerminal` と `release` の両方をこの関数経由にした。

## 検証

- ユニット: `test/src/composables/terminalRenderer.spec.ts`（順序・両方向の throw・null renderer・二重 dispose なし）。
- 実ブラウザ: 上の 10 回 × 2 の測定（`disposeTerminal` は**リポジトリから import した実物**）。
- 実アプリ（専用 HOME / ポート 34599、ビルド済み dist）:
  - shell セルを作る → 出力 → **閉じる**（release 経路）→ 端末 0・エラー 0 → もう 1 枚作って動作。
  - コレクションペインで chat 起動 → dock 切り替え → スプリッタ Home/End → **入力が通る**（画面が変化）、pageerror 無し。

## やらないこと

- `@xterm/addon-webgl` への移行（`docs/terminal-notes.md` の Renderer 節の検討事項。WebGL の
  コンテキスト上限と `onContextLoss` の設計が先）。この PR は順序の是正だけ。
- `guardBufferHealth` / `bufferIsShort` の閾値の見直し（リサイズ直後の判定が妥当かは別の問題）。
