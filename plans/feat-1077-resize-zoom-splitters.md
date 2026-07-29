# feat #1077 — 拡大時の一覧／サムネイル列をドラッグでリサイズする

## やること

grid view でセルを拡大しているときの 2 つの境界を、ドラッグとキーボードで動かせるようにする。

| モード | 境界 | 現状 | 保存キー |
|---|---|---|---|
| list roster | 一覧 ↔ 拡大セル（縦） | 一覧の幅 `basis-[360px]` 固定 | `roster_width` |
| thumbnail strip | 拡大セル ↔ サムネイル列（横） | 列の高さ `flex: 0 0 150px` 固定 | `strip_height` |

## 作らない。既にあるものの 3 つ目・4 つ目にする

同じ画面内に動いているスプリッターが 2 つある。

- 拡大セル ↔ Files ペイン（`TerminalGrid.vue` の `onSplitterDown` / `onSplitterKey`）
- single view のターミナル ↔ GUI パネル（`App.vue`）

幾何計算は `src/components/splitterWidth.ts` に切り出され、テスト済み。今回はそこに床値を渡せるようにして 4 つで共有する。**別に書くと、床の決着ルールが 4 つに分かれて必ず食い違う。**

### 決着ルールは引き継ぐ

既存の `splitterWidth.ts` が持つ「**両辺の床が同時に入らないときは、ターミナル側の床が勝つ**」を 4 つとも守る。理由も同じで、ターミナルが最小を割ると xterm の再流し込みが壊れる一方、詰まった一覧やサムネイルは単に窮屈なだけだから。

### 一般化の形

`primary` = 床が勝つ側（常にターミナル）、`secondary` = 先に床を譲る側。

```ts
export interface SplitFloors { primary: number; secondary: number }

maxPrimary(available, floors)
clampPrimary(size, available, floors)     // 床が勝つ側の寸法を丸める
clampSecondary(size, available, floors)   // 保存しているのが反対側のときに使う
splitterKeySize(key, current, available, floors, keys)  // keys で縦横を切り替える
```

既存の `clampTerminalWidth` / `maxTerminalWidth` / `clampPaneWidth` / `splitterKeyWidth` は
薄いラッパとして残す。ドメイン上の名前には意味があるし、`App.vue` を無変更にできる。

### 床の値

| 定数 | 値 | 理由 |
|---|---|---|
| `MIN_TERMINAL` | 320（既存） | xterm の横の再流し込みが壊れる下限 |
| `MIN_TERMINAL_HEIGHT` | 200 | 縦方向の同じ話。行数が一桁になると使えない |
| `MIN_ROSTER` | 240 | 1 行が status / dir / summary / prompt / reply。これ以下だと全行が省略記号になる |
| `MIN_STRIP` | 100 | サムネイルのヘッダ＋端末の一部が見える下限 |

## 実装メモ

- 一覧は既にユーティリティ（`basis-[360px]`）なので `:style` の `flexBasis` に変える。
  Files ペインが `:style="{ flex: '0 0 ' + paneWidth + 'px' }"` でやっているのと同じ形。
- サムネイル列の高さは `<style>` 側の `flex: 0 0 150px` が効いていて、ユーティリティでは
  詳細度で勝てない。**スタイルシートに規則を足さず**、その 1 行を
  `flex: 0 0 var(--strip-height, 150px)` に変え、値はコンポーネントから
  トークンとして渡す（CLAUDE.md「動的な値は utility が読む design token 経由」に沿う）。
- **一覧を広げると Files ペインの使える幅が減る。** 縦境界を動かしたあと `setPaneWidth` を
  呼び直さないと、ペインが拡大セルを床より下に押し込む。既存の `resize` ハンドラと
  同じ再クランプを、ドラッグ中にも通す。

## テスト

- `test/src/components/splitterWidth.spec.ts` — 一般化した関数に床値を渡すケース、
  縦キー（`ArrowUp` / `ArrowDown`）、床が同時に入らないときに primary が勝つこと。
  既存のケースはラッパ経由でそのまま通ること（決着ルールが変わっていない証拠になる）。
- 実ブラウザでの確認は `/verify` で行い、両モードのドラッグ・キー操作・リロード後保持・
  ウィンドウ縮小を見る。
