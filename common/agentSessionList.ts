// Where each agent's own past conversations are listed — one route per agent, keyed by the agent.
//
// The launcher's "or resume here" list shows the conversations of whatever the Agent Picker has
// selected, and each agent keeps its history in its own place: Claude in `~/.claude/projects`,
// codex in `~/.codex/sessions`, agy in its brain directory (found through our own log), grok in a
// per-cwd directory under `~/.grok/sessions`, muse and copilot each in a sqlite index of their own,
// cursor under `~/.cursor/projects/<slug>/agent-transcripts`. One store, one lister and one route
// per agent — so the route is chosen, not built.
//
// In `common/` because both sides decide from it: the server mounts these paths
// (server/routes/session-routes.ts) and the UI fetches them (src/composables/useDirLists.ts). A
// `Record<TerminalAgent, …>` rather than a lookup with a fallback, so a NEW agent is a TYPE
// ERROR here instead of a picker option that silently lists Claude's history under another name —
// which is the bug this whole map exists to fix (#1417).
import type { TerminalAgent } from "./sessionAgent.js";

export const AGENT_SESSION_LIST_PATHS: Record<TerminalAgent, string> = {
  claude: "/api/sessions",
  codex: "/api/codex/sessions",
  antigravity: "/api/antigravity/sessions",
  grok: "/api/grok/sessions",
  muse: "/api/muse/sessions",
  copilot: "/api/copilot/sessions",
  cursor: "/api/cursor/sessions",
};

/** The listing URL for one agent's conversations in one directory. */
export const agentSessionListUrl = (agent: TerminalAgent, cwd: string): string => `${AGENT_SESSION_LIST_PATHS[agent]}?cwd=${encodeURIComponent(cwd)}`;
