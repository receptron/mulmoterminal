import type { AgentAdapter } from "./types.js";

// Draft injection isn't wired for cursor yet, so it omits draftReadyMarker — the marker has to be
// read off a real cursor TUI, and a guessed one silently types into nothing.
export const cursorAdapter = {
  kind: "cursor",
  bin: () => process.env.CURSOR_BIN || "cursor-agent",
  binEnvVar: "CURSOR_BIN",
} satisfies AgentAdapter;
