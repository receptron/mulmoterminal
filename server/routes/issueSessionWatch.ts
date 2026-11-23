// What the watch over startIssueSession's implementers tells the session that started them (#3413):
// one line when an implementer's PR is merged or closed, when its session ends, and when it stops
// on the user. Pure: the loop hands in what it observed, and keeps what this returns.
import type { IssueSession, IssueSessionEnd } from "./issueSessions.js";

export type PrState = "OPEN" | "MERGED" | "CLOSED";

/** The agent reported it is blocked on the user: claude's Notification hook, and codex's
 *  PermissionRequest, which arrives under the same name (agents/codex/codex-hook.ts). A turn that
 *  merely ended (Stop) also sets `waiting`, and is not this — the implementer may be waiting on its
 *  review round, which the server types in. */
export const waitingOnPermission = (activity: { waiting?: boolean; event?: string | null } | undefined): boolean =>
  activity?.waiting === true && activity.event === "Notification";

export interface ImplementerObservation {
  running: boolean;
  /** The PR opened from the implementer's branch, or null when there is none yet (or it could not be read). */
  pr: { number: number; state: PrState } | null;
  /** Stopped on the user: a question dialog, or a permission prompt the agent reported. */
  blocked: boolean;
}

export type ImplementerEvent = { kind: IssueSessionEnd; pr: number | null } | { kind: "blocked" };

export interface WatchStep {
  event: ImplementerEvent | null;
  finished: IssueSessionEnd | null;
  /** Whether the next blocked observation is news: once told, the caller is not told again until it moves on. */
  blockedTold: boolean;
}

/** The PR first: a merge that ended the session is a merge, not an implementer that stopped. */
export function watchStep(observed: ImplementerObservation, blockedTold: boolean): WatchStep {
  const prNumber = observed.pr?.number ?? null;
  if (observed.pr?.state === "MERGED") return { event: { kind: "merged", pr: prNumber }, finished: "merged", blockedTold };
  if (observed.pr?.state === "CLOSED") return { event: { kind: "closed", pr: prNumber }, finished: "closed", blockedTold };
  if (!observed.running) return { event: { kind: "ended", pr: prNumber }, finished: "ended", blockedTold };
  if (!observed.blocked) return { event: null, finished: null, blockedTold: false };
  return { event: blockedTold ? null : { kind: "blocked" }, finished: null, blockedTold: true };
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
  return `${who}: its session ended before ${prText(event.pr)} was merged. ${room}. Tell the user, and start the next issue if one is left.`;
}
