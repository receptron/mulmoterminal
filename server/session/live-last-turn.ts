// The last completed turn of a session running in this process, read the way the handoff route
// reads it (routes/session-routes.ts `lastTurn`) but with the agent taken from the PTY rather than
// from a query string — the caller here is another agent, not the cell that knows its own kind.
import { ptys } from "./registry.js";
import { cwdForSessionHydrated } from "./session-cwd.js";
import { sessionLastTurn } from "./session-reads.js";
import { transcriptIdOf } from "./transcript/cleared-transcripts.js";
import { EMPTY_TURN, type LastTurn } from "./transcript/last-turn.js";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent.js";

/** A reader for the session's last turn, or why there is none: it is not running here, or its
 *  agent keeps no log this server parses (muse, #3375; a shell keeps none at all). */
export function liveTurnReader(sessionId: string): (() => Promise<LastTurn>) | string {
  const agent = ptys.get(sessionId)?.agent;
  if (agent === undefined) return `Session ${sessionId} is not running in this MulmoTerminal.`;
  if (!isTerminalAgent(agent) || agent === "muse") return `Replies from a ${agent} session cannot be read yet.`;
  return () => lastTurnOf(sessionId, agent);
}

async function lastTurnOf(sessionId: string, agent: TerminalAgent): Promise<LastTurn> {
  const transcriptId = transcriptIdOf(sessionId);
  if (transcriptId === null) return EMPTY_TURN;
  return sessionLastTurn(await cwdForSessionHydrated(sessionId), transcriptId, agent);
}
