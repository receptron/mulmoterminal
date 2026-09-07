# facts.json の version ドリフトを止める (#1988)

## 何が起きていたか

`docs/facts.json` は公開している機械可読な事実ファイル。その `version` が `4.4.0` のまま、
実際の公開版は 4.16.1 だった（12 リリース分）。`docs/facts.schema.json` には
`"Must match the version in package.json."` と**書いてある**のに、確かめるものが 1 つも無かった。

#1986（`engines.node` が 22.12 なのに doctor と docs が 22.9）と同じ形。真因も同じで、
**両側がそれぞれ自己整合**なので、どちらのテストも緑のまま食い違える。

## やること

1. `version` を 4.16.1 に更新
2. `test/scripts/factsJson.spec.ts` を追加し、`package.json` と一致させるべき値を固定する:
   - `facts.version` == `package.json.version`
   - `facts.requires.node` == `package.json.engines.node`（#1986 と同じ穴がこのファイルにもある）
3. `CLAUDE.md` の "Publishing a release" に 3 つめとして記載。1 / 2 と違い spec で止まることを明記

置き場所は `test/scripts/`。`tsconfig.test-server.json` が `test/scripts/**/*.ts` を含んでいるので
typecheck に載る。同じ性質の「マニフェスト同士の整合」チェックである
`mulmoclaudePeerRanges.spec.ts` の隣。

## 触らないもの

- **`updated`（2026-08-04）**。スキーマ上の意味は "When a human last checked this file against
  reality" —— 人が中身を実物と突き合わせた日であって、ファイルの最終更新日ではない。
  `version` を直すついでに today に書き換えると、このフィールドの意味が壊れる。
  棚卸しを実際にやったときに動かす。
- `facts.json` のそれ以外のフィールド。今回の issue の範囲外で、内容の正しさは別途確認が要る。

## 確認方法

pin した 2 値をそれぞれ**元の古い値に戻して赤くなること**を確認する
（`version` → 4.4.0、`requires.node` → `>=22.9`）。実際に起きた 2 つのドリフトそのものなので、
このテストが「起きたことを捕まえられる」ことの直接の証拠になる。
