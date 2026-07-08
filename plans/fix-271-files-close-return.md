# fix #271: Files view を閉じたら開いた元のビューに戻す

## 現象
グリッド（`/terminals`）でターミナルヘッダの 📁 から Files view を開き、閉じると
単一ビュー（`/` chat）に戻ってしまう。開いた元のグリッドに戻るべき。

## 原因
`src/composables/useFilesView.ts`:

```ts
export function filesClose(): void {
  router.push("/"); // 常に chat（単一ビュー）へ
}
```

戻り先が `/` にハードコードされている。`usePrsView.prsClose()` も同型。

## 修正
- 開くとき（`filesGotoIndex`）、`/files` 以外にいる場合のみ現在ルートの
  `fullPath` を `returnPath` に記録。
- `filesClose()` は `returnPath` へ戻す。
- `/files` にいる状態での再オープン（root 変更 / guarded close の revert:
  `FilesOverlay.vue` の `filesGotoIndex(prevCwd)`）では戻り先を上書きしない。
- モジュールレベル state。リロードで origin は失われるが、その場合は既定の
  `/`（chat）にフォールバック（許容）。

## テスト
`src/composables/useFilesView.spec.ts`（新規、singleton router を駆動）:
- グリッド起点 → close でグリッドに戻る
- 単一ビュー起点 → close で chat に戻る
- Files 内で root 変更しても origin（グリッド）を保持
- `?cwd=` を browsed root として公開

## スコープ外
`usePrsView` の同種挙動は今回未対応（報告は Files のみ）。必要なら別途。
