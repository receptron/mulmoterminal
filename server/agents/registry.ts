import type { AgentAdapter, AgentKind } from "./types.js";
import { claudeAdapter } from "./claude.js";

const adapters: Record<AgentKind, AgentAdapter> = {
  claude: claudeAdapter,
};

// Resolve the adapter for an agent kind. Defaults to Claude — the only agent today and
// the fallback for any session that doesn't name one.
export function getAgentAdapter(kind: AgentKind = "claude"): AgentAdapter {
  return adapters[kind];
}
