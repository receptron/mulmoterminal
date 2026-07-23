# feat — グリッド展開/折りたたみで全セルをアニメーションさせる

## 要望

グリッドからセルを expand したとき、ズームされるセル（main）は FLIP アニメーションで飛ぶが、**フィルムストリップに並ぶ他のセルは瞬間移動**していた。他のセルにも同じ動きをつけたい。展開・折りたたみの両方向。

## 現状

`TerminalGrid.vue` の `expandedUid` watch は `flipTargetUid` で**1つのセルだけ**を選び、それだけを `el.animate()` で FLIP していた。他のセルはスタイルシートのフェード（`cell-in` / `strip-in`）のみ。

## 変更

**全セルを FLIP する。** ただし飛べるのは**展開前後の両方に存在するセル**だけ:

- 展開: グリッドの現在ページ（≤9）→ 全セル（全タブ）。他タブのセルは「前」が無いので飛べない → フェードのまま
- 折りたたみ: 全セル → 現在ページ。他タブのセルは「後」が無い → 消える

この交差判定を純関数 `flipPairs(before, after)` に切り出す（`cellFlip.ts`）。コンポーネントは patch 前に全セルの矩形を測り、nextTick 後にもう一度測り、各ペアを `flipKeyframes` → `animate()` する。

### 実装詳細

- `flippingUid`（単一）→ `flippingUids`（`Set`）。CSS の `:not(.flipping)` 除外・`.stage.flipping` ゲートは複数対応
- `running`（単一 Animation）→ バッチ（`Animation[]`）。新しい展開/折りたたみは前のバッチを cancel。`Promise.allSettled` で最後の1つが終わったら settle
- reduced-motion / ズーム間スワップ（両端非 null）は従来どおり `shouldFlipZoom` でスキップ

## テスト

`flipPairs`:
- 前後両方にあるセルを各自の矩形でペア化
- 「前」が無いセル（他タブが到着）をスキップ
- 「後」が無いセル（折りたたみで退場）をスキップ
- 交差が空

`flipKeyframes` は既存テストで担保。

## 未検証

アニメーションの**見た目**は実機で要確認（180ms の途中フレームはスクショで捉えにくい）。純粋ロジックと配線の型・ビルドは確認済み。
