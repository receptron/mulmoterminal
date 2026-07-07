import type { AgentAdapter } from "./types.js";

// "shift+tab to cycle" is the permission-mode hint Claude Code paints once its input box
// is ready — the cue the draft-typing flow waits for before pasting a seed.
export const claudeAdapter: AgentAdapter = {
  kind: "claude",
  bin: () => process.env.CLAUDE_BIN || "claude",
  draftReadyMarker: /shift\+tab to cycle/,
};
