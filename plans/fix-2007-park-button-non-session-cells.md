# fix: launcher / command セルに死んだ park ボタンが出る

Issue: #2007

## User Prompt

> https://github.com/receptron/mulmoterminal/issues/2007 なおせる？

## 原因

`CellChromeButtons.vue` の park ボタンは `v-if="parked !== undefined"` で出し分けていた。
Vue は **宣言されていない boolean prop を `false` にキャストする**ので `parked === undefined` は
決して真にならず、ガードは常に真 = 全セル種別でボタンが描画されていた。

`LauncherCell` / `CommandCell` は `CellShell` → `cellChromeBinding` 経由でこのボタンを使い、その
イベント表は意図的に `toggle-park` を持たない（"minus the ones a cell binds itself"）。よって
emit は誰にも届かず、押しても何も起きない。park 機能が入った #992 (`a9b5268b`, 2026-07-31) から
一度も意図どおりに動いていない。

## 実機での確認（before / after）

隔離 `HOME`（launcher chip 1 つ）+ port 34611 の実サーバ、Playwright（Chromium）で
「terminal セル + launcher セル」のグリッドを描画して比較した。

- **before**: launcher セルのヘッダに park ボタンあり。クリックしても `aria-pressed` は `false` のまま、
  localStorage の grid 状態も `awake` のまま、console error も無し（= issue の報告どおり死んでいる）。
- **after**: launcher セルに park ボタンは出ない。terminal セルは従来どおりボタンを持ち、押すと
  `aria-pressed` が `true`、title が "Wake this terminal" になり、grid 状態が `parked` で永続化される。

## 修正

- `CellChromeButtons` に `canPark?: boolean` を追加し、ボタンのガードを `v-if="canPark"` にした。
  `parked` は押下状態（pressed / title / 配色）専用に残す。**「渡さないことで opt out する」は
  boolean prop では表現できない**ため、権限を表す prop を別に立てるのが最小の修正。
- `TerminalCell` の 2 か所（cockpit ヘッダ / 通常ヘッダ）だけが `:can-park="true"` を渡す。
  `CellShell` 経由の launcher / command セルは渡さない = ボタンが出ない。

## テスト

- `CellChromeButtons.spec.ts`: prop 未指定で非表示（`canPark: false` ではなく **未指定** を先に見る。
  false は壊れていた版の値そのものなので、それだけでは回帰を捕まえられない）、`parked` だけ来ても
  出ない、`canPark` で出る、押下状態、emit、close の直前という並び。
- `LauncherCell.spec.ts` / `CommandCell.spec.ts`: 実コンポーネントを mount して park ボタンが無いこと。
  issue が「observed」としたのは launcher 側だけで command 側は推測だったが、両方 mount して確認した。

## 同じ罠の掃き出し

`v-if` で `!== undefined` を見ている箇所は他に `FilterChip.vue` の `count` のみ。こちらは
`count?: number` で、Vue が数値 prop を勝手にキャストすることは無いため問題なし。
