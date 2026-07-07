import type { AgentAdapter, AgentKind } from "./types.js";
import { claudeAdapter } from "./claude.js";

const adapters: Record<AgentKind, AgentAdapter> = {
  claude: claudeAdapter,
};

// Resolve the adapter for a kind; Claude is the default and the fallback.
export function getAgentAdapter(kind: AgentKind = "claude"): AgentAdapter {
  return adapters[kind];
}
