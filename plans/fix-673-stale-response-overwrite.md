# fix #673 — 古い GET 応答が新しい状態を上書きする残り 2 箇所（#620 同族）

対象 issue: https://github.com/receptron/mulmoterminal/issues/673

#620 の行列（F1〜F5）は「GET 中に届いた **live 更新**を応答が上書きする」形だった。今回は同族だが「**同じ対象への 2 つの GET 応答が逆順で適用される**」型を 2 箇所直す。どちらも同じファイル／兄弟に確立済みのガードがあるのに、その箇所だけ漏れていた。

## G1. `src/components/TerminalCell.vue` — usage/context バッジ

`loadInitial`（seed）と `refreshUsage`（ターン終了時）の両方が `applyBadges` を呼ぶ。`loadInitial` は `latestSeed` で守られているが、**`refreshUsage` は無トークン**。連続してターンが終わると `/api/session` 読み取りが 2 つ同時に in-flight になり、古い方が後着すると前ターンの数値でバッジを巻き戻す（次の refresh まで固定）。

同ファイルの他の 5 fetch（resumable/scripts/…）は単調トークンで保護済み、GridView の `seedMeta` も per-id トークンを持つ。バッジ経路だけ取り残されていた。

**修正**: バッジ適用専用の `latestBadgeReq` を追加し、`loadInitial` と `refreshUsage` の**両方**が fetch 前に `++latestBadgeReq` して、適用前に `=== latestBadgeReq` を確認。最新のバッジ fetch が勝つ。`latestSeed`／`activityGen` の既存ロジックは不変。

## G2. `src/composables/useGitStatus.ts` — cwd→null 遷移

`refresh()` は `my === req` トークンを持つが、`cwd` が無いときの early return（`status.value = null; return;`）が `++req` の**前**にあった。dir→null 遷移（ランチャー／command セルへ切替）で `req` が増えないため、前 dir の in-flight 応答が `my === req` を通過して `status = null` を上書きし、**前のディレクトリのブランチチップが復活**する。dir→dir 遷移は両方 `++req` を通るので元から正しく、穴は dir→null の 1 遷移だけ。

**修正**: `++req` を early return の**前**へ移動。null 分岐でもトークンを進め、in-flight 応答を無効化する。

## テスト

- `test/src/components/TerminalCell.spec.ts`: 2 つの refreshUsage を逆順で解決させ、新しい方の数値が残ることを確認。
- `test/src/composables/useGitStatus.spec.ts`（新規）: `useGridActivity.spec` と同じ mount + gated-fetch ハーネスで、dir→null 後に古い応答が来ても `status` が null のままであることを確認。
- 両方とも修正を戻すと赤・入れると緑を変異テストで確認済み。
