# refactor: extract median as a correct pure function (#676 B7)

## Context

`scripts/model-trials.ts` の `median()` (55-59 行) は偶数長で **上側中央値**
(2 つの中央値のうち遅い方) を返していた:

```ts
const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]; // 偶数長で上側を返す = バグ
};
```

`runTrials` は成功した試行の秒数だけを集めるので、`--trials 3` で 2/3 合格のような
**偶数長**が普通に起きる。そのとき記録値が悲観側 (遅い方) に振れ、その数値が
`common/modelPresets.ts` のプリセット表へ**手動転記**され、最終的にランチャの
ピッカーに出る。挙動修正はユーザ承認済み。

`scripts/` はどの tsconfig の include にも入っておらず、その場に置いた spec は
typecheck・テストから解決できない。よって median を **`common/`** に切り出す。
`common/**/*.ts` は `tsconfig.app.json` (typecheck) と `tsconfig.server.json`
(typecheck:server) の両方で型検査され、`test/server` / `test/src` の双方から import できる。

## 変更

- 新ファイル `common/median.ts` に pure 関数 `median` を切り出し、**偶数長は 2 つの
  中央値の平均**を返す正しい定義に修正 (奇数長は不変)。
  - シグネチャ: `median(values: number[]): number | null`
  - 空配列 → `null`。それ以外は非破壊コピーを数値昇順ソートしてから中央を取る
    (元の `[...values].sort((a, b) => a - b)` の挙動を維持 — 未ソート・負値も正しく扱う)。
  - 偶数長: `(sorted[mid - 1] + sorted[mid]) / 2`、奇数長: `sorted[mid]`
    (`mid = Math.floor(length / 2)`)。
- `scripts/model-trials.ts` はローカル定義を削除し `../common/median.js` から import。
  既存の modelPresets の数値 (過去の測定値) は転記済みのため変更しない。
- テスト `test/server/median.spec.ts` (test-server tsconfig, strict):
  - 空 → `null` / 1 件 → その値
  - 偶数長 = 平均: `[2, 20]` → `11`
  - 奇数長 = 中央: `[1, 2, 20]` → `2`
  - 未ソート入力を内部でソートする (`[20, 1, 2]` → `2`, `[20, 2]` → `11`)
  - 負値・重複・境界 (2 要素平均が非整数になる `[11, 12]` → `11.5`)

## 変異テスト

平均を上側中央値 (`sorted[Math.floor(length / 2)]`) に戻すと偶数長テスト
(`[2, 20]` → `11` 等) が赤になることを確認してから戻す。

## 検証

- `prettier --write` / `eslint` / typecheck 3 種
  (`vue-tsc -b` / `tsc -p tsconfig.server.json` /
  `vue-tsc -p tsconfig.test.json --noEmit && tsc -p tsconfig.test-server.json`) /
  `vitest run test/server/median.spec.ts`。
