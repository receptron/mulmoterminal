// What closeIssueSession accepts, whom it refuses, whether an implementer's worktree may go, and what
// the caller is told (#3428). Pure: the route and the watch hand in what they read.
import { isRecord } from "../../common/isRecord.js";
import { SESSION_ID_RE } from "../config/env.js";
import type { IssueSession } from "./issueSessions.js";
import type { Parsed } from "./sessionAsk.js";

export interface CloseRequest {
  session: string;
  /** Close an implementer still at work. Strictly `true`: anything else is the safe default. */
  force: boolean;
}

export function parseCloseRequest(body: unknown): Parsed<CloseRequest> {
  const record = isRecord(body) ? body : {};
  const { session } = record;
  if (typeof session !== "string" || !SESSION_ID_RE.test(session))
    return { ok: false, error: "`session` must be the chatId startIssueSession returned for the implementer." };
  return { ok: true, session, force: record.force === true };
}

/** Why `caller` may not close `entry`, or null when it may. */
export function closeRefusal(entry: IssueSession | undefined, request: CloseRequest, caller: string): string | null {
  if (entry === undefined) return `Session ${request.session} is not an implementer startIssueSession started here, or it is already closed.`;
  if (entry.parent !== caller) return `Session ${entry.session} was started by another session; only that session can close it.`;
  if (entry.finished !== null || request.force) return null;
  return `Session ${entry.session} is still working on ${entry.repo}#${entry.issue}: its PR is neither merged nor closed. Leave it running, or ask the user; close it with force: true only when something is badly wrong.`;
}

/** What the worktree holds that no remote has. `unpushed` is the count of commits on no remote;
 *  null for either means it could not be read. */
export interface WorktreeFacts {
  exists: boolean;
  dirty: boolean | null;
  unpushed: number | null;
}

export type WorktreeVerdict = { remove: true } | { remove: false; reason: string };

/** Removed only when nothing in it would be lost: the PR may have been closed on unfinished work. */
export function worktreeVerdict(facts: WorktreeFacts): WorktreeVerdict {
  if (!facts.exists) return { remove: false, reason: "it is already gone" };
  if (facts.dirty === null || facts.unpushed === null) return { remove: false, reason: "git could not say whether it holds unpushed work" };
  if (facts.dirty) return { remove: false, reason: "it has uncommitted changes" };
  if (facts.unpushed > 0) return { remove: false, reason: `it has commits no remote has (${facts.unpushed})` };
  return { remove: true };
}

export type WorktreeOutcome = { removed: true } | { removed: false; reason: string };

export interface CloseResult {
  /** Reviewer sessions closed, and the ones that could not be. */
  reviewersClosed: string[];
  reviewersLeft: string[];
  implementerClosed: boolean;
  /** Null when the worktree was not touched because the implementer's cell is still open. */
  worktree: WorktreeOutcome | null;
}

function reviewerText(result: CloseResult): string[] {
  const lines: string[] = [];
  if (result.reviewersClosed.length > 0) lines.push(`Closed its reviewer sessions ${result.reviewersClosed.join(", ")}.`);
  if (result.reviewersLeft.length > 0) lines.push(`Could not close reviewer sessions ${result.reviewersLeft.join(", ")}: close their cells by hand.`);
  return lines;
}

function worktreeText(entry: IssueSession, outcome: WorktreeOutcome | null): string {
  if (outcome === null) return `Left its worktree ${entry.worktree}, since its cell is still open.`;
  if (!outcome.removed) return `Kept its worktree ${entry.worktree}: ${outcome.reason}.`;
  const branch = entry.branch === null ? "" : ` and local branch ${entry.branch} (the remote branch stays)`;
  return `Removed its worktree ${entry.worktree}${branch}.`;
}

/** What was closed and what was kept, after the implementer line. */
export function closeSummary(entry: IssueSession, result: CloseResult): string {
  const lines = [
    result.implementerClosed ? `Closed implementer session ${entry.session}.` : `Could not close implementer session ${entry.session}: close its cell by hand.`,
    ...reviewerText(result),
    worktreeText(entry, result.worktree),
  ];
  return lines.join(" ");
}
