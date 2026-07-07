import type { AgentAdapter } from "./types.js";

// "shift+tab to cycle" is the hint Claude paints once its input box is ready for a paste.
export const claudeAdapter: AgentAdapter = {
  kind: "claude",
  bin: () => process.env.CLAUDE_BIN || "claude",
  draftReadyMarker: /shift\+tab to cycle/,
};
