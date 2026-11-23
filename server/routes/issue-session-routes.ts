// The route behind startIssueSession (#3413): a session hands an issue to an implementer of its own,
// in the issue's worktree, carrying the review tools. Host tool, before the plugin catch-all.
//
// The worktree comes from startIssueWork — the board's start button — so the branch, the reuse of an
// issue's existing worktree and the one-session-per-worktree check are that function's, not a copy.
// The caller is the broker's header, an assertion rather than a credential (session-ask-routes.ts).
import type { Express } from "express";
import { SESSION_HEADER, sessionIdFromHeader } from "../backends/files/presentPathRoot.js";
import type { SpawnedSession, StartIssueWorkResult } from "../git/issue-work.js";
import type { SpawnIssueSession } from "../session/spawn/issue-session-spawn.js";
import type { FullGuiMcpAgent } from "../../common/guiMcpAgents.js";
import { messageOf } from "../errors.js";
import {
  implementerSeed,
  limitRefusal,
  parseStartRequest,
  runningCount,
  runningFor,
  startedMessage,
  type IssueSession,
  type StartRequest,
} from "./issueSessions.js";

type StartedWork = StartIssueWorkResult & Partial<SpawnedSession>;

export interface IssueSessionRouteDeps {
  sessions: Map<string, IssueSession>;
  isRunning: (session: string) => boolean;
  /** Whether the repository is on GitHub: the skill the implementer runs reads issues and PRs with gh. */
  isGitHub: (repo: string) => boolean;
  /** maxIssueSessions, read at each start. */
  limit: () => number;
  /** The repository's default clone here, or null when none is configured. */
  cloneOf: (repo: string) => Promise<string | null>;
  /** startIssueWork, with the spawn it seeds the worktree through. */
  startWork: (repo: string, issue: number, dir: string, spawnSeeded: (cwd: string, seed: string) => Promise<SpawnedSession>) => Promise<StartedWork>;
  /** Start the agent in the worktree, running `seed`, with every GUI tool. */
  spawn: (agent: FullGuiMcpAgent, cwd: string, seed: string) => Promise<SpawnedSession>;
  /** The caller may now sendToSession to the implementer. */
  recordSpawn: (child: string, parent: string) => void;
  /** Give the implementer a cell, as a visible spawnBackgroundChat session gets one. */
  markVisible: (session: string, agent: FullGuiMcpAgent) => void;
}

/** The implementer's spawn: the issue spawner, running its seed at once, on the default login, with
 *  every GUI tool — the review loop's tools reach no other way. */
export const implementerSpawn =
  (spawnIssueSession: SpawnIssueSession): IssueSessionRouteDeps["spawn"] =>
  (agent, cwd, seed) =>
    spawnIssueSession(agent, cwd, seed, true, null, { allTools: true });

function workFailure(deps: IssueSessionRouteDeps, request: StartRequest, work: StartedWork): string {
  // A second start for the same issue, queued behind the first in startIssueWork, finds the first's session there.
  if (work.ok && work.outcome === "resumed" && work.sessionId !== undefined && deps.sessions.has(work.sessionId))
    return `${request.repo}#${request.issue} is already being worked on by session ${work.sessionId}.`;
  if (work.ok && work.outcome === "resumed")
    return `${request.repo}#${request.issue}'s worktree ${work.worktree ?? ""} already has session ${work.sessionId ?? ""}, which was not started to run it to merge. Ask the user to open or close it.`;
  const detail = work.detail ? ` (${work.detail})` : "";
  return `Could not start ${request.repo}#${request.issue}: ${work.reason ?? "failed"}${detail}.`;
}

/** The implementer, recorded, or why there is none. */
async function startImplementer(deps: IssueSessionRouteDeps, parent: string, request: StartRequest, dir: string): Promise<IssueSession | string> {
  const work = await deps.startWork(request.repo, request.issue, dir, (cwd) => deps.spawn(request.agent, cwd, implementerSeed(request, parent)));
  if (!work.ok || work.outcome === "resumed" || work.sessionId === undefined || work.worktree === undefined) return workFailure(deps, request, work);
  const entry: IssueSession = {
    session: work.sessionId,
    parent,
    ...request,
    worktree: work.worktree,
    branch: work.branch ?? null,
    finished: null,
    blockedTold: false,
    prUnreadable: 0,
  };
  deps.sessions.set(entry.session, entry);
  deps.recordSpawn(entry.session, parent);
  deps.markVisible(entry.session, request.agent);
  return entry;
}

/** The start, run while it holds a place against the limit. */
async function claimedStart(deps: IssueSessionRouteDeps, parent: string, request: StartRequest): Promise<IssueSession | string> {
  try {
    const dir = await deps.cloneOf(request.repo);
    if (dir === null) return `${request.repo} has no clone configured here, so there is nowhere to cut its worktree.`;
    return await startImplementer(deps, parent, request, dir);
  } catch (err) {
    return `Could not start ${request.repo}#${request.issue}: ${messageOf(err)}`;
  }
}

export function mountIssueSessionRoutes(app: Express, deps: IssueSessionRouteDeps): void {
  // Claimed before the first await and released when the start settles, so two calls that arrive
  // together cannot both pass the limit while the worktree is cut.
  let starting = 0;
  app.post("/api/plugin/startIssueSession", async (req, res) => {
    const request = parseStartRequest(req.body);
    if (!request.ok) return res.json({ message: `startIssueSession: ${request.error}` });
    const parent = sessionIdFromHeader(req.get(SESSION_HEADER));
    if (!parent) return res.json({ message: "startIssueSession works only from a MulmoTerminal terminal." });
    if (!deps.isGitHub(request.repo))
      return res.json({ message: `${request.repo} is not a GitHub repository; the implementer's skill reads issues and pull requests with gh.` });
    const already = runningFor(deps.sessions.values(), request, deps.isRunning);
    if (already) return res.json({ message: `${request.repo}#${request.issue} is already being worked on by session ${already.session}.` });
    const limit = deps.limit();
    const refusal = limitRefusal(runningCount(deps.sessions.values(), deps.isRunning, starting), limit);
    if (refusal !== null) return res.json({ message: refusal });
    starting += 1;
    const entry = await claimedStart(deps, parent, request).finally(() => {
      starting -= 1;
    });
    if (typeof entry === "string") return res.json({ message: entry });
    const running = runningCount(deps.sessions.values(), deps.isRunning, starting);
    return res.json({ message: startedMessage(entry, running, limit), jsonData: { chatId: entry.session } });
  });
}
