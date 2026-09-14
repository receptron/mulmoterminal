// What a remote-host session is running. The server decides it (from the PtyEntry, or from
// what tmux says is in the pane) and the settings UI offers it as the scope for a quick
// command, so the list of kinds is a value both sides read.
export const SESSION_AGENTS = ["claude", "codex", "antigravity", "grok", "muse", "copilot", "cursor", "shell"] as const;

// Null anywhere this appears means the host cannot tell — a session that outlived a restart
// exists only in tmux, and nothing recorded what launched it. That is distinct from "shell".
export type SessionAgent = (typeof SESSION_AGENTS)[number];

// The agents a terminal can be LAUNCHED as, which is the session kinds minus "shell" (a shell is
// a launcher, not an agent). Claude is first because it is the default everywhere below.
export const TERMINAL_AGENTS = ["claude", "codex", "antigravity", "grok", "muse", "copilot", "cursor"] as const;

export type TerminalAgent = (typeof TERMINAL_AGENTS)[number];

// A remembered agent — a persisted grid cell, a localStorage toggle, a query param — read back.
// Validated rather than cast: anything unrecognised is Claude, which is also what an older
// persisted cell (written before the field existed) means.
export const asTerminalAgent = (value: unknown): TerminalAgent => (typeof value === "string" && isTerminalAgent(value) ? value : "claude");

// Narrowing rather than coercing, for the callers that must be able to say "this is not an agent
// at all": a shell is a session kind but not something a cell can be relaunched AS, and reading
// one as Claude (which asTerminalAgent does, correctly, for a remembered value) would offer to
// resume a shell as a conversation.
//
// Takes a plain string so the same question can be asked of a PROGRAM NAME — a launcher runs the
// user's own command line, and whether that command line is an agent is the same list.
export const isTerminalAgent = (agent: string): agent is TerminalAgent => TERMINAL_AGENTS.some((known) => known === agent);

// Every agent that is NOT the default. Claude is the absent case in more than one place — a grid
// cell stores its agent only when it is not Claude, and only a non-Claude session wears a badge —
// and each of those had spelled the list out as `"codex" | "antigravity"`, which is a list to
// forget when a fourth agent arrives. Derived, so there is nothing to forget.
export type BadgedAgent = Exclude<TerminalAgent, "claude">;

export interface AgentBadge {
  /** Where there is room for it — a sidebar row, a header bar. */
  full: string;
  /** For the tab bar, which fits about two characters between the dot and the title. */
  short: string;
}

// Claude has no badge on purpose: it is the default everywhere, so badging it would put one on
// nearly every row and stop the badge meaning "this one is different". A shell is not an agent
// and reaches this with no entry, which is the same answer.
const AGENT_BADGES: Partial<Record<TerminalAgent, AgentBadge>> = {
  codex: { full: "codex", short: "cx" },
  antigravity: { full: "agy", short: "agy" },
  grok: { full: "grok", short: "gk" },
  muse: { full: "muse", short: "mu" },
  copilot: { full: "copilot", short: "cp" },
  cursor: { full: "cursor", short: "cu" },
};

/** How a session row announces which agent it is running, or null when it wears no badge. The one
 *  place the wording lives: the sidebar and the tab bar show the SAME list, so a literal compared
 *  in each is how the two came to disagree about a third agent. */
export function agentBadge(agent: string | null | undefined): AgentBadge | null {
  const known = TERMINAL_AGENTS.find((candidate) => candidate === agent);
  return known ? (AGENT_BADGES[known] ?? null) : null;
}
