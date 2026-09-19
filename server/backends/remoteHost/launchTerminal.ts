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
  // Whether that session still EXISTS here — a live pty, or a tmux session that survived a
  // restart. Asked separately from the directory because the two answers have different
  // lifetimes: the remembered-cwd log is append-only, so it keeps answering for ids that
  // stopped existing weeks ago (#2181, Codex review on PR #2190). Without this the phone could
  // name any id it had ever seen and start a process in whatever that path is NOW — a wider set
  // than the sessions its own list offers, which is built from live ptys and tmux.
  //
  // A FACT rather than a lookup, unlike `cwdOf`: answering it exactly needs an await (see the
  // caller), and a rule that cannot be resolved synchronously should not pretend otherwise.
  sessionExists: boolean;
  // Browsers subscribed to the launch channel. The grid is browser state, so with none
  // listening nothing can open the cell and the phone must be told, not left waiting.
  listenerCount: number;
}

// Shared with the caller: the listener count is read before publishing, so a tab that closes
// in between makes delivery fail after this said yes. Both paths report the same thing.
export const NO_BROWSER_ERROR = "no MulmoTerminal browser is open — the grid opens the terminal, so a tab must be connected";

export function decideLaunchTerminal({ agent, sessionId, cwdOf, sessionExists, listenerCount }: LaunchTerminalInput): LaunchTerminalDecision {
  if (!isLaunchAgent(agent)) return { ok: false, error: `agent must be one of: ${LAUNCH_AGENTS.join(", ")}` };
  if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "sessionId is required" };
  // Before the directory, and with its own message: "that session is gone" and "nobody wrote down
  // where it ran" are different things to be told on a phone.
  if (!sessionExists) return { ok: false, error: `session '${sessionId}' is no longer running here` };
  const cwd = cwdOf(sessionId);
  if (!cwd) return { ok: false, error: `no working directory known for session '${sessionId}'` };
  if (listenerCount < 1) return { ok: false, error: NO_BROWSER_ERROR };
  return { ok: true, request: { agent, cwd } };
}
