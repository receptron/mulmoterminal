# fix #720 — cockpit roster が auto ソートを反映しない

## 背景 / 症状

グリッドをズームしたときに出る cockpit roster（サイドメニュー、`data-testid="cockpit"`）の行順が
auto（注目度順）ソートを反映しない。auto にしても blocked / waiting のセルがロースター上部に
浮いてこず、追加した順（生順）のまま並ぶ。グリッド／フィルムストリップ（`displayCells`）は auto
が効いているので、両者で並び順が食い違う。

## 根本原因

`GridView.vue` でグリッドとロースターが別々の順序ソースを使っている:

- グリッド `displayCells = visibleOrdered(state, statusForSort)` … `orderCells` 適用済み（auto 反映）
- ロースター `listRows = state.value.cells.map(...)` … 生順のまま、`orderCells` を通していない

`orderCells`（純関数・テスト済み）をロースター側に通し忘れた取りこぼし。意図的に生順にした形跡
（コメント等）はなし。

## 修正

`GridView.vue`:

1. `orderCells` を import に追加。
2. 注目度順の全セルを 1 本の computed に切り出す:
   ```ts
   const orderedCells = computed(() => orderCells(state.value.cells, statusForSort.value, state.value.sortMode));
   ```
   これを **グリッドとロースターの単一の順序ソース**にして、二度と食い違わないようにする。
   - `displayCells` … ズーム時は `orderedCells`、非ズーム時はページスライス（現 `visibleOrdered` と等価）。
   - `listRows` … `orderedCells.value.map(...)`（メタ組み立ては現状のまま）。

挙動:
- auto: ロースターもグリッドと同じ注目度順（blocked→done→idle→working、末尾 launcher）で浮上。
- manual: `orderCells` は生順を返すため現状維持。⋮ の上下入れ替え（manual 限定）にも影響なし。

## テスト

- `orderCells` / `visibleOrdered` の既存純関数テストはそのまま（順序ロジックは変えない）。
- `GridView.spec.ts` に統合テストを追加:
  - `useGridActivity` をモックして特定セッションを blocked にする。
  - `grid_v2` を seed（auto ＋ 1 セルを expanded＝ズーム、status 差のあるセッション群）。
  - `TerminalGrid` スタブに渡る `listRows` の uid 順が **注目度順（blocked 先頭）** で、生順ではない
    ことを検証。
  - 旧コード（`state.value.cells.map`）では生順になり fail することを確認してから修正。

## 確認事項（レビュー観点）

- ロースターが status 変化のたびに行を入れ替える点（`orderCells` は stable sort なので、順位が
  変わったセルだけ動く。グリッドと同じ挙動）。これが望ましい（監視用途）前提。
- `visibleOrdered` を GridView から外す場合、テストのみ利用になるが knip 上問題ないか（→ 本 PR では
  `visibleOrdered` の内部ロジックを `orderedCells` + ページスライスへインライン化し、export は残す）。
