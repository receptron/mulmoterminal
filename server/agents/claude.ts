import type { AgentAdapter } from "./types.js";

// "shift+tab to cycle" is the hint Claude paints once its input box is ready for a paste.
// `satisfies` (not a `: AgentAdapter` annotation) keeps draftReadyMarker's concrete type so
// callers that rely on it (the draft-injection scanner) don't see it as possibly-undefined.
export const claudeAdapter = {
  kind: "claude",
  bin: () => process.env.CLAUDE_BIN || "claude",
  draftReadyMarker: /shift\+tab to cycle/,
} satisfies AgentAdapter;
