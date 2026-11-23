// What the watch over startIssueSession's implementers tells the session that started them (#3413):
// one line when an implementer's PR is merged or closed, when its session ends, and when it stops
// on the user. Pure: the loop hands in what it observed, and keeps what this returns.
import type { IssueSession, IssueSessionEnd } from "./issueSessions.js";

export type PrState = "OPEN" | "MERGED" | "CLOSED";

/** The agent's newest hook says it is blocked on the user: claude's Notification, and codex's
 *  PermissionRequest, which arrives under the same name (agents/codex/codex-hook.ts). Any later hook —
 *  the tool running once answered, the turn ending — moves it on. Not the `waiting` flag: that is also
 *  the unread mark, set by a turn that merely ended, while the implementer may be waiting on its
 *  review round, which the server types in. */
export const waitingOnPermission = (newestHookEvent: string | undefined): boolean => newestHookEvent === "Notification";

/** gh could not be asked, or its answer could not be read — not the same as "no PR". */
export const PR_UNREADABLE = "unreadable";

// An implementer whose session ended is reported once gh says how its PR stands; past this many
// passes in a row with no answer it is reported as ended anyway, rather than never.
export const ENDED_UNREADABLE_PASSES = 10;

export interface ImplementerObservation {
  running: boolean;
  /** The newest PR from the implementer's branch, null when there is none yet, or PR_UNREADABLE. */
  pr: { number: number; state: PrState } | null | typeof PR_UNREADABLE;
  /** Stopped on the user: a question dialog, or a permission prompt the agent reported. */
  blocked: boolean;
}

export type ImplementerEvent = { kind: IssueSessionEnd; pr: number | null; prUnread?: true } | { kind: "blocked" };

/** What the watch carries from one pass to the next for an implementer. */
export interface WatchMemory {
  /** Once told it is waiting on the user, the caller is not told again until it moves on. */
  blockedTold: boolean;
  /** Passes in a row on which gh could not say how its PR stands. */
  prUnreadable: number;
}

export interface WatchStep extends WatchMemory {
  event: ImplementerEvent | null;
  finished: IssueSessionEnd | null;
}

function blockedStep(blocked: boolean, memory: WatchMemory): WatchStep {
  const { prUnreadable } = memory;
  if (!blocked) return { event: null, finished: null, blockedTold: false, prUnreadable };
  return { event: memory.blockedTold ? null : { kind: "blocked" }, finished: null, blockedTold: true, prUnreadable };
}

/** The PR first: a merge that ended the session is a merge, not an implementer that stopped. An
 *  unread PR never finishes a running implementer, and finishes an ended one only after
 *  ENDED_UNREADABLE_PASSES — a merge gh could not see on one pass must not become "ended" for good. */
export function watchStep(observed: ImplementerObservation, memory: WatchMemory): WatchStep {
  // Copied field by field: the memory handed in may be a whole entry or a whole step.
  const { blockedTold } = memory;
  if (observed.pr === PR_UNREADABLE) {
    const unread: WatchMemory = { blockedTold, prUnreadable: memory.prUnreadable + 1 };
    if (observed.running || unread.prUnreadable < ENDED_UNREADABLE_PASSES) return blockedStep(observed.running && observed.blocked, unread);
    return { event: { kind: "ended", pr: null, prUnread: true }, finished: "ended", ...unread };
  }
  const read: WatchMemory = { blockedTold, prUnreadable: 0 };
  const prNumber = observed.pr?.number ?? null;
  if (observed.pr?.state === "MERGED") return { event: { kind: "merged", pr: prNumber }, finished: "merged", ...read };
  if (observed.pr?.state === "CLOSED") return { event: { kind: "closed", pr: prNumber }, finished: "closed", ...read };
  if (!observed.running) return { event: { kind: "ended", pr: prNumber }, finished: "ended", ...read };
  return blockedStep(observed.blocked, read);
}

const prText = (pr: number | null): string => (pr === null ? "its PR" : `its PR #${pr}`);

/** The line typed into the session that started the implementer. */
export function watchMessage(entry: IssueSession, event: ImplementerEvent, running: number, limit: number): string {
  const who = `[startIssueSession] ${entry.repo}#${entry.issue} (session ${entry.session})`;
  const room = `${running} of ${limit} implementers are running`;
  if (event.kind === "blocked")
    return `${who} is waiting for the user in its cell: a question or a permission prompt. Tell the user; do not answer it for them.`;
  if (event.kind === "merged") return `${who}: ${prText(event.pr)} was merged. ${room}; start the next issue if one is left.`;
  if (event.kind === "closed")
    return `${who}: ${prText(event.pr)} was closed without merging. ${room}. Tell the user, and start the next issue if one is left.`;
  if (event.prUnread)
    return `${who}: its session ended, and gh could not say how its PR stands. ${room}. Tell the user, and start the next issue if one is left.`;
  return `${who}: its session ended before ${prText(event.pr)} was merged. ${room}. Tell the user, and start the next issue if one is left.`;
}
