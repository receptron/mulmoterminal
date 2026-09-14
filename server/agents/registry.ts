import type { AgentAdapter, AgentKind } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { antigravityAdapter } from "./antigravity.js";
import { grokAdapter } from "./grok.js";
import { museAdapter } from "./muse.js";
import { copilotAdapter } from "./copilot.js";
import { cursorAdapter } from "./cursor.js";

const adapters: Record<AgentKind, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  antigravity: antigravityAdapter,
  grok: grokAdapter,
  muse: museAdapter,
  copilot: copilotAdapter,
  cursor: cursorAdapter,
};

// Resolve the adapter for a kind; Claude is the default and the fallback.
export function getAgentAdapter(kind: AgentKind = "claude"): AgentAdapter {
  return adapters[kind];
}
