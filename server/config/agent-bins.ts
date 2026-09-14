// Which binary each hosted agent runs, and which model override it was given.
//
// Resolved ONCE at boot rather than per spawn, which is what makes `<AGENT>_BIN` a start-up
// setting: changing it in the environment of a running server changes nothing, and that is the
// existing behaviour this lift preserves.
//
// The model line is per agent and always the same shape — `<AGENT>_MODEL`, or null to leave the
// CLI on whatever it is configured to use. Claude has none here because its model is chosen per
// session by the launch form rather than by the environment.
import { claudeAdapter } from "../agents/claude.js";
import { codexAdapter } from "../agents/codex.js";
import { antigravityAdapter } from "../agents/antigravity.js";
import { grokAdapter } from "../agents/grok.js";
import { museAdapter } from "../agents/muse.js";
import { copilotAdapter } from "../agents/copilot.js";
import { cursorAdapter } from "../agents/cursor.js";

export const AGENT_BINS = {
  claude: claudeAdapter.bin(),
  codex: codexAdapter.bin(),
  antigravity: antigravityAdapter.bin(),
  grok: grokAdapter.bin(),
  muse: museAdapter.bin(),
  copilot: copilotAdapter.bin(),
  cursor: cursorAdapter.bin(),
} as const;

export const AGENT_MODELS = {
  codex: process.env.CODEX_MODEL || null,
  antigravity: process.env.ANTIGRAVITY_MODEL || null,
  grok: process.env.GROK_MODEL || null,
  muse: process.env.MUSE_MODEL || null,
  copilot: process.env.COPILOT_MODEL || null,
  // Cursor's model names are account-specific and a wrong one is FATAL — the CLI exits printing the
  // whole list rather than falling back — so an operator setting this checks `cursor-agent
  // --list-models` first (server/agents/cursor-args.ts).
  cursor: process.env.CURSOR_MODEL || null,
} as const;
