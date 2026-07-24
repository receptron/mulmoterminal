# fix: ファイル D&D でページごと画像に遷移する (#750)

## 原因

ブラウザはファイルをページに落とすと既定でそのファイルを開く（遷移）。止めるには
dragover と drop の両方で preventDefault を、ドロップされうる全領域で呼ぶ必要があるが、
現状は `Terminal.vue` のターミナル本体 div だけに付いており、外側（ヘッダー・隙間・背景）に
「うっかり」落とすと遷移していた。加えて `onDrop` は preventDefault の前に return する枝が
あり、Chrome ではパスが取れず無言で何も起きなかった。

## 修正

1. **window レベルのガード**（`src/composables/useFileDropGuard.ts` の `installFileDropGuard`）を
   `main.ts` で 1 回インストール。ファイルドラッグ（`dragCarriesFiles` = types に "Files"）の
   dragover / drop を preventDefault し、どこに落としても遷移しない。ターミナル本体のハンドラは
   バブリングで先に走るのでパス挿入のハッピーパスは維持。in-app のドラッグ（"Files" を含まない）は
   素通し。
2. **`onDrop` を修正**: 判定を `dragCarriesFiles` に統一し preventDefault を確実化。パスが取れた
   ときは挿入、取れなかったとき（Chrome 等）は **📎 ボタン（Insert a file path）を使うよう促す
   一時ヒント**を表示。
3. ヒント文言は `translateUiSentence`（`src/utils/translateUi.ts`、AbortController タイムアウト付き）で
   ランタイム翻訳（このホストは静的 i18n を持たない）。

## テスト

- `dragCarriesFiles` の純関数テスト（dropPaths.spec）。
- `installFileDropGuard`: fake target で preventDefault の呼び出し/非呼び出し/teardown、
  さらに**実 window** に cancelable な drop を dispatch して `defaultPrevented` を検証。
- `translateUiSentence`: en は無 fetch、非 en は翻訳、失敗系は英語フォールバック。

## 非対象

- #729/#737 の選択・ホイール系には触れない。
