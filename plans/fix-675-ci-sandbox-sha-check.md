# fix #675 — ci-sandbox-image の「編集で sha が変わった」チェックが恒真

対象 issue: https://github.com/receptron/mulmoterminal/issues/675

## 問題

`scripts/ci-sandbox-image.ts` のシナリオ3で、「Dockerfile を編集すれば sha が変わる」ことを守る自己チェックが、

```ts
check("the edit changed the Dockerfile sha",
      editedSha === original.toString() ? "unchanged" : "changed", "changed");
```

と **sha256 の hex 文字列(`editedSha`)** と **Dockerfile 本文(`original.toString()`)** を比較していた。種類の違う文字列なので永久に不一致 → 三項は必ず `"changed"` → 恒真で何も検証していない。直後の「変更された Dockerfile がリビルドする」保証が痩せる。

## 修正

編集**前**の sha を取り、sha 同士を比較する。

```ts
const shaBeforeEdit = dockerfileSha();
...
check("the edit changed the Dockerfile sha", editedSha === shaBeforeEdit ? "unchanged" : "changed", "changed");
```

## 「壊すと落ちる」確認

修正後、`dockerfileSha()` が壊れて編集で sha が変化しなくなると `editedSha === shaBeforeEdit` が真 → `"unchanged"` → check が期待値 `"changed"` と不一致で `process.exit(1)`。修正前は比較対象が常に不一致で必ず通過していた。これで本来の番人として機能する。

CI スクリプト(Docker 実機依存)なので vitest 単体テストは追加しない。
