import type { AgentAdapter } from "./types.js";

// Draft injection isn't wired for codex yet, so it omits draftReadyMarker.
export const codexAdapter = {
  kind: "codex",
  bin: () => process.env.CODEX_BIN || "codex",
} satisfies AgentAdapter;
