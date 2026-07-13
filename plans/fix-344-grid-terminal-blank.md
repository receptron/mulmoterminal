# fix #344 — grid で放置→復活/reload 時にターミナルが空表示

## 症状
grid view で、放置してセッションが切れた後、復活や reload でターミナルが何も表示されない。
スクロール／reload で直ることがある。

## 根本原因
xterm は `host` div に一度だけ `open()` され、再アタッチ時に host を DOM 上で re-parent する
（`useTerminalConnections`）。レンダラは **canvas**（CJK ずれ対策）。canvas renderer は
re-parent 後や「サイズ不変の fit（no-op）」では自動再描画しない：

- grid は `<KeepAlive>` 配下 → 離脱→復帰で `Terminal.vue` の `onActivated` が `conn.fit()` を呼ぶが
  サイズ不変だと no-op → canvas が空のまま。
- `attach()`（再アタッチ）も host を re-parent → 同様。
- バッファは保持されるので、**スクロールで再描画されて直る**（＝データ喪失ではなく repaint 問題）。

## 修正 — `src/composables/useTerminalConnections.ts`
- `fit()` の末尾に `if (rows>0) term.refresh(0, rows-1)` を追加。fit が no-op でも canvas を強制再描画。
  これで onActivated / ResizeObserver / 初回 RO 経由の全 fit が repaint を伴う。
- `attach()`：re-parent 後、`requestAnimationFrame(() => fit(key))` で次フレームに再 fit+再描画
  （sync fit が未レイアウトや no-op でも確実に repaint）。`attachedEl === el` ガードで
  detach/再attach 済みスロットは触らない。

## 非スコープ
- WebGL レンダラへの切替（CJK 対策で canvas 採用のため）。
- reload 直後の遅延バッファに対する追加 refresh（初回 ResizeObserver の fit で概ねカバー、
  必要なら追随）。

## テスト
- レンダリング（xterm+DOM+rAF）のため単体テストは困難。手動確認：放置→復活/reload/タブ切替で空表示にならないこと。
EOF
echo "plan written"