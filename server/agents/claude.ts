import type { AgentAdapter } from "./types.js";

// The status line Claude paints under its input box once that box is ready for a paste.
// Two spellings because it is a UI string that has already drifted once: "shift+tab to
// cycle" is what older versions printed, "? for shortcuts" is what 2.1.220 prints in every
// mode. Both are kept — the marker has to work against whatever claude the user has, and a
// version that prints neither still lands on draft-injection's quiet fallback.
//
// NO SPACES, and lowercase: this is matched against `squashForMarker`'s output (see
// server/session/pty-scan.ts), because the raw pty stream carries cursor-positioning
// escapes BETWEEN the words — "?ESC[24GforESC[28Gshortcuts" — so a spaced regex matches
// nothing that a terminal actually sends.
//
// `satisfies` (not a `: AgentAdapter` annotation) keeps draftReadyMarker's concrete type so
// callers that rely on it (the draft-injection scanner) don't see it as possibly-undefined.
export const claudeAdapter = {
  kind: "claude",
  bin: () => process.env.CLAUDE_BIN || "claude",
  binEnvVar: "CLAUDE_BIN",
  draftReadyMarker: /shift\+tabtocycle|\?forshortcuts/,
} satisfies AgentAdapter;
