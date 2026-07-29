// Whether the phone's "open a terminal here" request can be served, and what to publish
// (#831). Pure (no I/O) so every refusal is unit-tested; the caller supplies the session's
// directory and how many browsers are listening.
import { LAUNCH_AGENTS, isLaunchAgent, type LaunchAgent } from "../../../common/launchAgent.js";

// What the grid needs to open the cell. The cwd is the HOST's answer for the session the
// phone was looking at — the phone never sends a path, so a remote client cannot name a
// directory to start a process in.
export interface LaunchTerminalRequest {
  agent: LaunchAgent;
  cwd: string;
}

export type LaunchTerminalDecision = { ok: true; request: LaunchTerminalRequest } | { ok: false; error: string };

export interface LaunchTerminalInput {
  agent: unknown;
  sessionId: unknown;
  // The session's working directory, or null when the host has none for it — a session that
  // outlived a restart exists only in tmux and no PtyEntry remembers where it runs.
  cwdOf: (sessionId: string) => string | null;
  // Browsers subscribed to the launch channel. The grid is browser state, so with none
  // listening nothing can open the cell and the phone must be told, not left waiting.
  listenerCount: number;
}

// Shared with the caller: the listener count is read before publishing, so a tab that closes
// in between makes delivery fail after this said yes. Both paths report the same thing.
export const NO_BROWSER_ERROR = "no MulmoTerminal browser is open — the grid opens the terminal, so a tab must be connected";

export function decideLaunchTerminal({ agent, sessionId, cwdOf, listenerCount }: LaunchTerminalInput): LaunchTerminalDecision {
  if (!isLaunchAgent(agent)) return { ok: false, error: `agent must be one of: ${LAUNCH_AGENTS.join(", ")}` };
  if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "sessionId is required" };
  const cwd = cwdOf(sessionId);
  if (!cwd) return { ok: false, error: `no working directory known for session '${sessionId}'` };
  if (listenerCount < 1) return { ok: false, error: NO_BROWSER_ERROR };
  return { ok: true, request: { agent, cwd } };
}
