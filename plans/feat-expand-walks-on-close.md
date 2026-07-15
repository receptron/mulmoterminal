# feat: expand 中に閉じたら隣のセルへ expand を移す（#376）

Issue: #376 / Branch: `feat/expand-walks-on-close`

## User Prompt

grid view の expand で、expand している terminal を閉じると、普通の view に戻るけど、1つ前の terminal を expand した状態にしてそのままにしてほしい。一番前の terminal を閉じた場合は次を開くとして。

## 挙動

- expand 中のセルを閉じる → フィルムストリップ表示順の**前のセル**を expand（ズーム維持）。
- 閉じたのが**先頭（一番前）**セル → **次のセル**を expand。
- 残りセルが無い（最後の1枚を閉じた）→ 通常ビューへ（従来どおり）。
- expand 中に**非expand セル**を閉じた場合は現在の expand を維持。

## 実装

- `src/components/gridTabs.ts` `closeCell(state, uid, order?)`: `order`（画面表示順の uid 配列）を追加引数に。閉じたのが `state.expanded === uid` のとき、`order` 上の前（`idx-1`）、先頭なら次（`idx+1`）の uid を新しい `expanded` に。隣が無い/`order` 未指定なら `null`（従来の un-zoom）にフォールバック。
- `src/components/GridView.vue` `onClose`: `displayCells.value.map(c => c.uid)` を渡す。zoom 中は `visibleOrdered` が全件（＝フィルムストリップ順）を返すので、隣は「見えている順」で選ばれる。
- テスト（`gridTabs.spec.ts`）: 前/次(先頭)/最後の1枚/非expand/`order`未指定フォールバック。

## 検証

- `yarn lint`（0 error）/ `yarn build` / `yarn test`（1147 パス）。純粋関数の単体テストで挙動を担保。
