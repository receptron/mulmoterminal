// What startIssueSession accepts, what it counts against the limit, and what it tells the caller
// (#3413). Pure: the route hands in the table, which sessions are still running, and the limit.
import { isRecord } from "../../common/isRecord.js";
import { isIssueNumber } from "../../common/prPhase.js";
import { isRepoEntry } from "../../common/repoEntry.js";
import { agentCarriesFullGuiMcp, FULL_GUI_MCP_AGENTS, type FullGuiMcpAgent } from "../../common/guiMcpAgents.js";
import { isTerminalAgent } from "../../common/sessionAgent.js";
import type { Parsed } from "./sessionAsk.js";

/** An implementer startIssueSession started, for as long as this process runs. */
export interface IssueSession {
  session: string;
  /** The session that started it, and the one told about it. */
  parent: string;
  repo: string;
  issue: number;
  agent: FullGuiMcpAgent;
  worktree: string;
  branch: string | null;
}

export interface StartRequest {
  repo: string;
  issue: number;
  agent: FullGuiMcpAgent;
}

const AGENTS_TEXT = FULL_GUI_MCP_AGENTS.join(", ");

/** The agents a started session can be handed the review tools on: the ones given their MCP per spawn. */
function agentOf(value: unknown): FullGuiMcpAgent | null {
  if (value === undefined) return "claude";
  return typeof value === "string" && isTerminalAgent(value) && agentCarriesFullGuiMcp(value) ? value : null;
}

export function parseStartRequest(body: unknown): Parsed<StartRequest> {
  const record = isRecord(body) ? body : {};
  const { repo, issue } = record;
  if (typeof repo !== "string" || !isRepoEntry(repo)) return { ok: false, error: "`repo` must be the repository, as owner/repo." };
  if (!isIssueNumber(issue)) return { ok: false, error: "`issue` must be the issue number." };
  const agent = agentOf(record.agent);
  if (agent === null) return { ok: false, error: `\`agent\` must be one of ${AGENTS_TEXT}, or left out for claude.` };
  return { ok: true, repo, issue, agent };
}

/** Implementers still running here, plus starts that have claimed a place and not finished spawning. */
export function runningCount(sessions: Iterable<IssueSession>, isRunning: (session: string) => boolean, starting: number): number {
  return [...sessions].filter((entry) => isRunning(entry.session)).length + starting;
}

export function limitRefusal(running: number, limit: number): string | null {
  if (running < limit) return null;
  return `${running} implementers are already running, the most maxIssueSessions allows (${limit}). Start the next issue when one of them finishes.`;
}

/** The implementer already working on this issue, when one is still running. */
export function runningFor(
  sessions: Iterable<IssueSession>,
  request: { repo: string; issue: number },
  isRunning: (session: string) => boolean,
): IssueSession | undefined {
  return [...sessions].find((entry) => entry.repo === request.repo && entry.issue === request.issue && isRunning(entry.session));
}

/** The implementer's first turn. Prose rather than a `/skill` line, which codex and copilot do not read. */
export function implementerSeed(request: { repo: string; issue: number }, parent: string): string {
  return [
    `Use the "mulmoterminal-issue-to-merge" skill to take ${request.repo}#${request.issue} to merge, working in this directory, which is the issue's worktree.`,
    `Session ${parent} started you and is told when you finish or stop. Ask your questions here, in this session: the user answers them in this cell.`,
  ].join("\n\n");
}

export function startedMessage(entry: IssueSession, running: number, limit: number): string {
  return `Started ${entry.agent} session ${entry.session} on ${entry.repo}#${entry.issue} in ${entry.worktree}. It runs the issue to merge and asks the user its own questions in its cell. ${running} of ${limit} implementers are running.`;
}
