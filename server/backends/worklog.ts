// Periodic cross-clone dev-work log — a BUILT-IN, opt-in scheduled task (like
// feed-refresh). When `worklog.enabled`, it fires every `intervalHours` and spawns a
// Claude session seeded with WORKLOG_PROMPT, which merges recent work across the user's
// saved working dirs (cwdPresets) — grouped by repository so multiple clones collapse
// into one summary — into weekly wiki pages, and reconciles progress against
// vision/milestones. The batch self-scaffolds the wiki pages and its state file, so a
// user only has to flip the flag. See plans/feat-worklog-vision.md (#351).
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";
import type { TaskDefinition } from "@mulmoclaude/core/scheduler";

const HOUR_MS = 3_600_000;

// The run window is [lastRunAt, now], NOT a fixed interval: user/system tasks aren't
// caught up, so a missed or slept-through run can leave a >intervalHours gap that a
// fixed window would silently drop. lastRunAt is the high-water mark in worklog-state.json.
export const WORKLOG_PROMPT = `あなたは開発作業ログのバッチです。カレントディレクトリ（ワークスペース = CLAUDE_CWD）で以下を実行してください。秘密情報（APIキー/トークン/.envの中身/Authorizationヘッダ等）は絶対にログに書かないこと。

1. 集計期間を決める。\`date\` で現在時刻(JST)を確認。\`config/scheduler/worklog-state.json\` を読み \`lastRunAt\`(ISO文字列) を得る。window = [lastRunAt, 今]。ファイルが無ければ初回とみなし window = 直近24時間。**固定6時間にしないこと**（実行が飛んで実間隔が延びることがあるため、前回実行以降を必ずカバーする）。

2. 対象ディレクトリを集める。\`~/.mulmoterminal/config.json\` を読み \`cwdPresets\`（ユーザーが実際に開いた working dir 群）の path 一覧を得る。存在しない path はスキップ。

3. 各 dir の作業を収集（window 内のみ）。
   - Claude セッション: \`~/.claude/projects/\` 配下で、その dir に対応する transcript(*.jsonl) のうち mtime が lastRunAt 以降のものを探す（\`find ~/.claude/projects -name '*.jsonl' -newermt "<lastRunAt>"\` 等）。中身から「何をやろうとしていたか / 主要な変更・判断 / 未完・次の一手」を把握。
   - git: その dir が git リポなら \`git -C <dir> log --since="<lastRunAt>" --oneline\` と必要なら \`--stat\` で実際のコミットを補完。

4. **リポジトリ単位でマージ**。同じリポの複数 clone/worktree（例: mulmoterminal, mulmoterminal2, mulmoterminal3、あるいは同名の別 path）は、git remote（origin URL）または clone サフィックスを除いたリポ名でグループ化し、**1つのリポの作業としてまとめる**。dir ごとに分断しない。

5. リポ（グループ）ごとに 3〜6行で要約: やったこと / 主要な変更・決定 / 未完・次の一手。

6. vision / マイルストーン照合。\`data/wiki/pages/vision.md\` と \`data/wiki/pages/milestones.md\` を読む（無ければ空の雛形を作成: vision.md は「# Vision」見出しのみ、milestones.md は「# Milestones」見出し＋チェックリストの説明のみ）。今回の作業が各マイルストーンをどれだけ進めたか、**進んでいないマイルストーンは何か**を明記（＝忘却検知）。自動で目標を書き換えないこと（読むだけ。進捗の所見はログ側に書く）。

7. 週次ログに追記。ISO週(YYYY-Www)を \`date\` から算出し \`data/wiki/pages/dev-log-YYYY-Www.md\` を対象にする（無ければ「# 作業ログ YYYY-Www」見出しで作成）。ファイル先頭付近（新しい順）に次のセクションを追記し、既存内容は消さない:
   \`## YYYY-MM-DD HH:MM JST（window: <from> – <to>）\`
   その下に リポごとの要約 と マイルストーン照合。関連ページには \`[[vision]]\` \`[[milestones]]\` でリンク。

8. 成功したら \`config/scheduler/worklog-state.json\` を \`{"lastRunAt":"<今のISO>"}\` で更新（**書き出しに成功した時のみ**。失敗時は更新せず、次回に取りこぼしを持ち越す）。

9. 最後に、書いたログの1行サマリと対象 window を通常メッセージで報告。`;

// Build the built-in worklog system task, or null when disabled. `intervalHours` sets
// the cadence; the actual run window is still [lastRunAt, now] (see WORKLOG_PROMPT).
export function worklogSystemTask(deps: { enabled: boolean; intervalHours: number; spawnChat: (message: string) => void }): TaskDefinition | null {
  if (!deps.enabled) return null;
  const intervalMs = Math.max(1, Math.round(deps.intervalHours)) * HOUR_MS;
  return {
    id: "system.worklog",
    description: "Periodic cross-clone dev worklog → weekly wiki pages",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs },
    run: async () => {
      deps.spawnChat(WORKLOG_PROMPT);
    },
  };
}
