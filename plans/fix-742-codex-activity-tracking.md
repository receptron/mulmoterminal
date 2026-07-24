# fix: codex セッションの状態追跡の取りこぼし（#742）

## User Prompt

> mulmoclaude で全ファイルをレビューして…（略）バグを issue 化し、順に対応・CI・レビュー対応・マージまで進める

## 1. 中断ターンで working フラグが残り続ける

`turnBoundaries`（`server/agents/codex-activity.ts`）は `event_msg` の payload type のうち
`task_started` と `task_complete` しか境界として扱っていなかった。

実データ（`~/.codex/sessions`）で確認:
- 400ファイル中の payload type 集計で `task_started` 540 / `task_complete` 512（差 28）/ `turn_aborted` 25。
- 実際のロールアウトで、Esc 中断したターンは `task_started`(207) → `turn_aborted`(242) で
  `task_complete` を書かないことを確認（`task_complete` の後に何も無い）。
- 「エラー」で終わったターンは `task_complete` を出すので、影響は中断のみ。

`codex-activity-track.ts` は `started` で working=true、`completed` でのみ解除するため、
中断ターンは working のまま → スピナー回りっぱなし、完了 push 無し、`reapDecisionFor` が
keep を返して切断済みセッションが回収されない。

**修正**: `TURN_END_TYPES = { task_complete, turn_aborted }` を追加し、どちらも `completed` 境界にする。

## 2. ワークスペースからスキルを削除しても codex 側のミラーが残る

`syncCodexSkills`（`server/agents/codex-skills.ts`）は source に現存するディレクトリ名しか
走査しないため、`.claude/skills` から消えたスキルの `$CODEX_HOME/skills/<name>`
（`.mt-mirror` マーカー付き）が永久に残り、codex が削除済みスキルを読み続ける。

**修正**: `removeOrphanedMirrors(destDir, keep)` を追加。
dest 側を走査し、マーカーを持つ（＝ours）のに source に無いものを削除する。
codex 自身のスキル（マーカー無し）は決して触らない。source ディレクトリごと消えた場合も
全ミラーを orphan として削除。返り値に `removed: string[]` を追加。

## テスト

`test/server/agents/codex-activity.spec.ts`:
- `turn_aborted` が completed 境界になること（回帰）。TURN_END_TYPES から外すと赤になることを確認。
- 正常ターン→中断ターンの並び。

`test/server/agents/codex-skills.spec.ts`:
- source から消えた ours ミラーが削除される（回帰）。rmSync をスキップすると赤になることを確認。
- codex 自身のスキル（マーカー無し）は削除しない。
- source ディレクトリごと消えた場合に全 orphan を削除。

全 typecheck / lint / 該当テストパス。
