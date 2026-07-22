// Which terminal slots hold a conversation another cell can read, and what that
// conversation is addressed by. Split from useTerminalConnections so the rule is
// reachable without a live WebSocket or an xterm instance — the connection manager
// is a module singleton, so a filter written inside it can only be tested by
// standing the whole thing up.

// A slot's readability, flattened out of the connection runtime. Everything here is
// a plain value so a caller can construct one; the manager maps its Conn onto it.
export interface SlotCandidate {
  key: string;
  connected: boolean;
  isCommand: boolean; // a script.json / header-button run — output, not a conversation
  isShellLauncher: boolean; // the OS shell — no agent, so no log
  sessionId: string | null; // absent until the server reports one
  cwd: string | null;
  codex: boolean;
}

export interface SlotInfo {
  key: string;
  sessionId: string;
  cwd: string | null;
  agent: "claude" | "codex";
}

// The readable form of a slot, or null when there is nothing to read. A slot without a
// session id is dropped rather than listed-and-broken: the id is what locates the log,
// so a cell that hasn't launched has nothing to offer yet.
export function readableSlot(candidate: SlotCandidate): SlotInfo | null {
  if (!candidate.connected || candidate.isCommand || candidate.isShellLauncher || !candidate.sessionId) return null;
  return { key: candidate.key, sessionId: candidate.sessionId, cwd: candidate.cwd, agent: candidate.codex ? "codex" : "claude" };
}
