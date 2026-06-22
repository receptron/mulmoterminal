# feat: グリッドセルの header に「意味のある」プロンプトを出す

## 背景 / User Prompt

> 今、直近の user prompt を header に出しているけど、なにをやっているか要約をだすことはできないよね？
>
> （課題の整理）`ok` や `マージ` みたいな簡素な指示が最後だと、そのセッションが結局何の作業か分からなくなる。文字数で filter して、短い場合はもっと古いのを参照すれば良い？

→ おすすめ（**文字数フォールバック＋ack denylist 併用**）で実装。

## 設計

セル header は今 `lastPrompt`（＝最後の UserPromptSubmit プロンプト）を出している。`ok`/`はい`/`マージ`
のような **trivial なつなぎ指示**が最後だと本題が埋もれる。そこで **「最後の *意味のある* プロンプト」**
を出すようにする。表示側（`TerminalCell.vue`）は変更不要 — サーバが渡す `lastPrompt` を「意味のあるもの」に
するだけ。

### trivial 判定（純粋関数, テスト対象）
`server/transcript.ts` に `isTrivialPrompt(text)`:
- 前後の空白・句読点を除去し小文字化
- 空 → trivial
- ack denylist（`ok`/`yes`/`merge`/`はい`/`マージ`/`続けて`/`お願いします` 等）に一致 → trivial
- コードポイント長 < 4 → trivial（`ok`/`はい`/`マージ`/`yes` を拾う。`バグ直して`(5) 等は残す）

### 適用箇所（サーバ）
1. **ライブ**（UserPromptSubmit フック, `index.ts`）: `lastPrompts.set` を **trivial なら上書きしない**
   （ただし未設定時は最初のプロンプトを入れる）。＝ 直近の意味あるプロンプトを保持。
2. **resume/初期**（トランスクリプト, `index.ts:latestUserPrompt`）: `latestMeaningfulUserPromptFromJsonl`
   を使い、新しい順に走査して最初の非 trivial を返す（全部 trivial なら最新へフォールバック）。

`transcript.ts` は `collectPrompts` に切り出し、`latestUserPromptFromJsonl`（従来挙動）と
`latestMeaningfulUserPromptFromJsonl`（新）の両方を提供。

## 変更
- `server/transcript.ts`: `isTrivialPrompt` / `latestMeaningfulUserPromptFromJsonl` / `collectPrompts`
- `server/index.ts`: import 差し替え、`latestUserPrompt` を meaningful 版に、ライブフックで trivial 上書き抑止
- `server/transcript.spec.ts`: `isTrivialPrompt` / `latestMeaningfulUserPromptFromJsonl` のテスト

## 確認ポイント
- 閾値（長さ < 4）と denylist は控えめ。意味ある短い日本語（`バグ直して`）は残す方針
- 全プロンプトが trivial なセッションは最新（trivial）を出す（空表示にはしない）
- 別 PR（#87 とは独立、main ベース）
