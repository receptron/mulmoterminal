// The watch over startIssueSession's implementers (#3413): every few seconds, for each one still at
// work, it looks at the PR from its branch, whether its session still runs, and whether it stopped on
// the user — and types what changed into the session that started it. That session never polls; the
// progress lives here, not in its context (#3403, decision 1).
import { messageOf } from "../errors.js";
import type { IssueSession } from "./issueSessions.js";
import { runningCount } from "./issueSessions.js";
import { PR_UNREADABLE, watchMessage, watchStep, type ImplementerObservation } from "./issueSessionWatch.js";
import type { BranchPr } from "../git/pr-of-branch.js";

export const ISSUE_WATCH_INTERVAL_MS = 30_000;

export interface IssueSessionWatchDeps {
  sessions: Map<string, IssueSession>;
  isRunning: (session: string) => boolean;
  /** The newest PR from the branch that was not already over at `sinceMs`. */
  prOf: (repo: string, branch: string, sinceMs: number) => Promise<BranchPr | null | typeof PR_UNREADABLE>;
  /** A question dialog is open, or the agent reported it is waiting on a permission prompt. */
  blocked: (session: string) => Promise<boolean>;
  /** Type the line into `parent` once nothing holds its input, unless `ended` says it is gone. */
  deliver: (parent: string, text: string, ended: () => boolean) => Promise<void>;
  limit: () => number;
  /** Close an implementer whose PR was merged or closed (#3428), answering what it closed and kept. */
  closeFinished: (entry: IssueSession) => Promise<string>;
}

async function observe(deps: IssueSessionWatchDeps, entry: IssueSession): Promise<ImplementerObservation> {
  const running = deps.isRunning(entry.session);
  const [pr, blocked] = await Promise.all([
    entry.branch === null ? Promise.resolve(null) : deps.prOf(entry.repo, entry.branch, entry.startedAtMs),
    running ? deps.blocked(entry.session) : Promise.resolve(false),
  ]);
  return { running, pr, blocked };
}

/** A close that failed must not keep the starter from hearing that the PR ended. */
async function closeFinished(deps: IssueSessionWatchDeps, entry: IssueSession): Promise<string> {
  try {
    return await deps.closeFinished(entry);
  } catch (err) {
    return `Could not close it: ${messageOf(err)}. Close its cell with closeIssueSession.`;
  }
}

/** One look at one implementer: record what it came to, and tell its starter when that is news. */
async function watchOne(deps: IssueSessionWatchDeps, entry: IssueSession): Promise<void> {
  const observed = await observe(deps, entry);
  // closeIssueSession closed it while gh was asked: its starter already knows.
  if (deps.sessions.get(entry.session) !== entry) return;
  const step = watchStep(observed, entry);
  entry.blockedTold = step.blockedTold;
  entry.prUnreadable = step.prUnreadable;
  if (step.finished !== null) entry.finished = step.finished;
  if (step.event === null) return;
  const closed = step.finished === "merged" || step.finished === "closed" ? ` ${await closeFinished(deps, entry)}` : "";
  const text = `${watchMessage(entry, step.event, runningCount(deps.sessions.values(), deps.isRunning, 0), deps.limit())}${closed}`;
  // Not awaited: a dialog holding one starter's input must not hold back the look at the others.
  deps
    .deliver(entry.parent, text, () => !deps.isRunning(entry.parent))
    .catch((err: unknown) => console.error(`[startIssueSession] could not tell session ${entry.parent} about ${entry.repo}#${entry.issue}: ${messageOf(err)}`));
}

/** One pass over every implementer still at work. A starter that is gone is not told, but its
 *  implementers are still followed, so the place each holds is given back when it finishes. */
export async function watchIssueSessions(deps: IssueSessionWatchDeps): Promise<void> {
  const atWork = [...deps.sessions.values()].filter((entry) => entry.finished === null);
  await Promise.all(
    atWork.map((entry) =>
      watchOne(deps, entry).catch((err: unknown) => console.error(`[startIssueSession] could not look at ${entry.repo}#${entry.issue}: ${messageOf(err)}`)),
    ),
  );
}

/** Looks again ISSUE_WATCH_INTERVAL_MS after each pass ends, so a slow gh never runs two passes at once. */
export function startIssueSessionWatch(deps: IssueSessionWatchDeps, intervalMs = ISSUE_WATCH_INTERVAL_MS): void {
  const pass = (): void => {
    void watchIssueSessions(deps).finally(() => setTimeout(pass, intervalMs).unref());
  };
  setTimeout(pass, intervalMs).unref();
}
