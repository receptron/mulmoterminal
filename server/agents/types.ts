// A coding-agent CLI that a terminal session can host. Claude is the only agent today;
// Codex and Antigravity are added in later PRs (see plans/feat-multi-agent-support.md).
//
// This interface owns ONLY the parts that genuinely differ per agent. Everything else —
// PTY persistence, reattach, the grid, pubsub, and the GUI-MCP broker — stays shared,
// because the broker is keyed by the session id in its URL and doesn't care which CLI
// is talking to it. The interface starts deliberately small (the fields Claude already
// needs); argv construction, session-id capture, resume, MCP injection, and skill seeding
// join it in the PRs that introduce the agents that force their shape.

export type AgentKind = "claude";

export interface AgentAdapter {
  readonly kind: AgentKind;
  // The executable to spawn. Each agent reads its own env override (CLAUDE_BIN today,
  // CODEX_BIN / ANTIGRAVITY_BIN later), resolved at call time so the env can change per boot.
  bin(): string;
  // The TUI status line that signals the input box is ready for bracketed-paste draft
  // typing. Each agent's TUI paints a different hint, so this cue is per-agent.
  readonly draftReadyMarker: RegExp;
}
