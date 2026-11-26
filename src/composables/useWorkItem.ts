// What this cell is working on — the branch's PR and the issue behind it — for the header chip.
// Literally the same poll as useGitStatus now (usePollWhileVisible, plus a cwd watch), because it
// answers the same question about the same directory and a user who commits or opens a PR expects
// both chips to catch up together — which is only true if neither can drift from the other.
//
// The interval is slow on purpose: the server caches each (repo, branch) answer for 30s and the
// call behind it shells out to `gh`, so polling faster buys nothing but subprocesses.
import { ref, watch, type Ref } from "vue";
import { usePollWhileVisible } from "./usePollWhileVisible";
import { EMPTY_WORK_ITEM, isIssueNumber, isPrPhase, type WorkItem } from "../../common/prPhase";
import { isRecord } from "../../common/isRecord";
import { safeHttpsUrl } from "../../common/httpsUrl";
import { isIssueWorkCommentsEnabled } from "./issueWorkComments";
import type { WorkCommentKind } from "../../common/workComment";
import { isWorkCommentFailure, type WorkCommentFailure } from "../../common/workCommentFailure";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import { dirApiUrl, isRemoteDirKey } from "./dirAddress";
import { fireConfettiForEvent } from "./useConfetti";

const POLL_MS = 30_000;

// There is no PR #0 and no negative issue: a stale or malformed response saying so must render
// nothing rather than an impossible link (found by CodeRabbit review).
const numberOrNull = (v: unknown): number | null => (isIssueNumber(v) ? v : null);

const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

// The server is the only writer of this shape, but it is a network response: an old build, a
// proxy returning HTML, or a half-deployed server would otherwise put `undefined` in the chip.
export function parseWorkItem(data: unknown): WorkItem {
  if (!isRecord(data) || !isPrPhase(data.phase)) return { ...EMPTY_WORK_ITEM };
  return {
    phase: data.phase,
    pr: numberOrNull(data.pr),
    prUrl: safeHttpsUrl(data.prUrl),
    issue: numberOrNull(data.issue),
    issueUrl: safeHttpsUrl(data.issueUrl),
    // The chip shows numbers, not words — the titles ride along for the phone (#1014), and are
    // parsed here so the wire type has one reader rather than two disagreeing ones.
    prTitle: textOrNull(data.prTitle),
    issueTitle: textOrNull(data.issueTitle),
    // Words the UI prints, so they go through the same check as the titles rather than straight
    // from the wire. Null on GitHub, and on any server too old to send it (#981).
    blockedReason: textOrNull(data.blockedReason),
  };
}

// Nothing to show: no PR, no issue — or the PR is merged, which is the point at which the cell
// has stopped working on it (#979). A closed PR reads the same way.
export function hasWorkToShow(item: WorkItem): boolean {
  if (item.phase === "merged" || item.phase === "closed") return false;
  return item.pr !== null || item.issue !== null;
}

// What the cell should tell the issue, comparing the poll before with the poll now (#979 Phase 2,
// #1369). A cell arriving on an issue says so once; a PR appearing and a PR turning `merged` are
// reported as they happen. Everything else — an unchanged state, a phase moving inside the review
// loop, CI going red and green again — says nothing.
//
// "Arriving" includes the first poll after a reload, on purpose: this side cannot know what was
// already said, only the issue can. The server is idempotent, so re-asking is the design, not a
// leak — see server/git/work-comment.ts.
/** This session watched the same pull request turn merged: it was here on the previous poll, not
 *  yet merged. Arriving at a merged state (a reload, a cell left on an old branch) is not a merge. */
export const becameMergedPr = (before: WorkItem, now: WorkItem): boolean =>
  now.phase === "merged" && now.pr !== null && before.pr === now.pr && before.phase !== "merged";

export function workCommentToPost(before: WorkItem, now: WorkItem): WorkCommentKind | null {
  if (now.issue === null) return null;
  // "Merged" is only reportable when this session WATCHED it happen: the same PR was here on the
  // previous poll and was not merged yet. Arriving at a merged state is not the same event — a
  // reload, or a cell left on last month's branch, would otherwise announce (and try to close)
  // issues that were finished long ago, all at once, the first time the setting is switched on.
  if (now.phase === "merged") return before.pr !== null && before.pr === now.pr && before.phase !== "merged" ? "merged" : null;
  if (now.phase === "closed") return null;
  // "Start" is safe to repeat after a reload — it is a standing fact, not an event, and the
  // server writes it at most once per (issue, directory).
  if (before.issue !== now.issue) return "start";
  // The PR is reported under the merge's rule rather than the start's: the comment stamps a TIME
  // against it, and a reload finding a month-old PR would stamp the reload. Only a PR that appears
  // while this cell is watching the same issue has a time this side actually knows.
  //
  // Compared rather than tested for null, so a SECOND pull request — the first one closed unmerged
  // — is reported too. It is a milestone of its own, and the server keys the line by number.
  return now.pr !== null && before.pr !== now.pr ? "pr" : null;
}

/** Why the issue could not be updated, or null — including when it WAS updated, when the server
 *  had nothing to add, and when the setting is off. Only a cause the server actually named makes
 *  a notice (#1369). */
async function postWorkComment(cwd: string, item: WorkItem, kind: WorkCommentKind): Promise<WorkCommentFailure | null> {
  try {
    const res = await fetchWithTimeout(
      "/api/work-comment",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, issue: item.issue, pr: item.pr, kind }),
      },
      SLOW_COMMAND_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    // A rejected request means this app called its own server wrongly, and a browser that cannot
    // reach the server is already visible everywhere else — neither is the user's to fix here.
    // The deadline above is still armed here on purpose (#1393), so this read is bounded too.
    return isRecord(data) && isWorkCommentFailure(data.failure) ? data.failure : null;
  } catch {
    // Best-effort: the next transition (or the next reload) asks again, and the server dedupes.
    return null;
  }
}

/** `cwd` is a directory key (dirAddress.ts): a remote one is read through the gateway. */
export function useWorkItem(cwd: Ref<string | null>) {
  const item = ref<WorkItem>({ ...EMPTY_WORK_ITEM });
  // Why the last attempt to update the issue failed. Held rather than logged: the user turned the
  // setting on and would otherwise see the same nothing as leaving it off (#1369).
  const commentFailure = ref<WorkCommentFailure | null>(null);
  let req = 0;

  async function refresh(): Promise<void> {
    // Bumped before the early return for the same reason as useGitStatus: a cell losing its dir
    // must invalidate an in-flight fetch, or the previous dir's PR reappears in the header.
    const my = ++req;
    const dir = cwd.value;
    if (!dir) {
      item.value = { ...EMPTY_WORK_ITEM };
      // The notice belongs to an issue in a directory. With neither, it is about work this cell
      // has left behind, and would sit there claiming a problem the user can no longer act on.
      commentFailure.value = null;
      return;
    }
    try {
      const res = await fetchWithTimeout(dirApiUrl(dir, "/api/pr-phase"), undefined, SLOW_COMMAND_TIMEOUT_MS);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (my !== req) return;
      const next = parseWorkItem(data);
      if (becameMergedPr(item.value, next)) fireConfettiForEvent("pr-merged");
      const enabled = isIssueWorkCommentsEnabled();
      const kind = enabled ? workCommentToPost(item.value, next) : null;
      item.value = next;
      // Cleared when there is nothing left for a comment to be about — the setting is off, or the
      // branch carries no issue. NOT merely because this poll had nothing to report: a cause is
      // recorded on a milestone, and every poll between milestones reports nothing, so clearing on
      // those would take the notice down about 30 seconds after it appeared — the same silence it
      // exists to end. Switching the setting off is the case a user reaches FOR the notice, and
      // leaving it up then would argue with the switch they just used. Moving to a DIFFERENT issue
      // needs no case here: that is a `start` milestone, so the attempt below overwrites the cause.
      if (!enabled || next.issue === null) commentFailure.value = null;
      // Assigned rather than only set on failure, so a milestone that lands after the setup was
      // fixed takes the notice back down without waiting for a reload. Guarded by the same request
      // token as the item above: this call outlives the fetch, and a cell that moved to another
      // directory meanwhile must not be told about the repository it left — `permission` is a
      // per-repository answer.
      // Not on a remote directory yet: the comment is a write, and this server would post it for its own repo.
      if (kind && !isRemoteDirKey(dir)) {
        void postWorkComment(dir, next, kind).then((failure) => {
          if (my === req) commentFailure.value = failure;
        });
      }
    } catch {
      // leave the last value; the next tick retries
    }
  }

  usePollWhileVisible(() => void refresh(), POLL_MS);
  watch(cwd, () => void refresh());

  return { item, refresh, commentFailure };
}
