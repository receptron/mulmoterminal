// Closing a startIssueSession implementer (#3428): its reviewers, its cell, then its worktree. Shared by
// closeIssueSession and the watch, which closes one once its PR is merged or closed. Host tool, before
// the plugin catch-all; the caller is the broker's header, an assertion rather than a credential.
import type { Express } from "express";
import { SESSION_HEADER, sessionIdFromHeader } from "../backends/files/presentPathRoot.js";
import { messageOf } from "../errors.js";
import type { IssueSession } from "./issueSessions.js";
import { closeRefusal, closeSummary, parseCloseRequest, type CloseResult, type WorktreeOutcome } from "./issueSessionClose.js";
import type { ReviewLoop } from "./reviewLoop.js";

export interface IssueSessionCloseDeps {
  sessions: Map<string, IssueSession>;
  loops: Map<string, ReviewLoop>;
  /** End the session and close its cell; false when its tmux session is still there. */
  close: (session: string) => boolean;
  /** Removes a closed reviewer's worktree, as endReview does. Never throws. */
  dropWorkspace: (loop: ReviewLoop) => Promise<void>;
  removeWorktree: (worktree: string) => Promise<WorktreeOutcome>;
}

function closeOne(deps: IssueSessionCloseDeps, session: string): boolean {
  try {
    return deps.close(session);
  } catch (err) {
    console.error(`[closeIssueSession] could not close session ${session}: ${messageOf(err)}`);
    return false;
  }
}

/** The review loops the implementer ran, ended, and their reviewers closed with their worktrees. A
 *  loop whose reviewer is still starting names none yet (""); that start ends its reviewer itself
 *  once it sees the loop gone. */
async function closeReviewers(deps: IssueSessionCloseDeps, implementer: string): Promise<{ closed: string[]; left: string[] }> {
  const authored = [...deps.loops].filter(([, loop]) => loop.author === implementer);
  authored.forEach(([key]) => deps.loops.delete(key));
  const started = authored.map(([, loop]) => loop).filter((loop) => loop.reviewer !== "");
  const closed = started.filter((loop) => closeOne(deps, loop.reviewer));
  await Promise.all(closed.map((loop) => deps.dropWorkspace(loop)));
  return { closed: closed.map((loop) => loop.reviewer), left: started.filter((loop) => !closed.includes(loop)).map((loop) => loop.reviewer) };
}

async function worktreeAfterClose(deps: IssueSessionCloseDeps, worktree: string): Promise<WorktreeOutcome> {
  try {
    return await deps.removeWorktree(worktree);
  } catch (err) {
    return { removed: false, reason: messageOf(err) };
  }
}

/** Forgotten first, before any await, so a second close of the same implementer finds nothing, and
 *  remembered again when its cell would not close, so the starter can try again. The worktree goes
 *  only once the cell is gone: its shell stands in it. */
export async function closeImplementer(deps: IssueSessionCloseDeps, entry: IssueSession): Promise<CloseResult> {
  deps.sessions.delete(entry.session);
  if (entry.finished === null) entry.finished = "ended";
  const reviewers = await closeReviewers(deps, entry.session);
  const implementerClosed = closeOne(deps, entry.session);
  if (!implementerClosed) deps.sessions.set(entry.session, entry);
  const worktree = implementerClosed ? await worktreeAfterClose(deps, entry.worktree) : null;
  return { reviewersClosed: reviewers.closed, reviewersLeft: reviewers.left, implementerClosed, worktree };
}

export function mountIssueSessionCloseRoute(app: Express, deps: IssueSessionCloseDeps): void {
  app.post("/api/plugin/closeIssueSession", async (req, res) => {
    const request = parseCloseRequest(req.body);
    if (!request.ok) return res.json({ message: `closeIssueSession: ${request.error}` });
    const caller = sessionIdFromHeader(req.get(SESSION_HEADER));
    if (!caller) return res.json({ message: "closeIssueSession works only from a MulmoTerminal terminal." });
    const entry = deps.sessions.get(request.session);
    const refusal = closeRefusal(entry, request, caller);
    if (refusal !== null || entry === undefined) return res.json({ message: refusal });
    const result = await closeImplementer(deps, entry);
    return res.json({ message: `${entry.repo}#${entry.issue}: ${closeSummary(entry, result)}` });
  });
}
