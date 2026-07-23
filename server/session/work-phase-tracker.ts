// The work phase (planning vs implementing) of a LIVE turn, tracked from Claude's hooks.
//
// The roster derives the same thing by parsing the transcript (readSessionSummary →
// currentTurnToolNamesFromParsed → classifyWorkPhase), which is fine for a request handler but
// not for the publish path: that sits on the synchronous hook Claude waits on, and must not read
// files. So the turn's tool names are accumulated as the hooks arrive instead, and handed to the
// SAME classifier — the two agree on vocabulary even though they observe different sources.
//
// The turn boundary mirrors the transcript rule: a fresh user prompt starts a new turn, and every
// tool the agent then runs belongs to it. A tool-result round trip does NOT reset (only
// UserPromptSubmit does), so an Edit early in a turn keeps reading as "implementing" through the
// verification reads that follow it.
import { classifyWorkPhase, type WorkPhase } from "./workPhase.js";

const TURN_START_EVENT = "UserPromptSubmit";
const TOOL_START_EVENT = "PreToolUse";
// One turn's tools; a long turn is capped so a runaway session can't grow this without bound.
// The classifier only asks "was there a mutation", which the oldest entries already answer.
const TURN_TOOLS_LIMIT = 200;

/** The turn's tool names after one hook. Pure, so the boundary rule can be pinned. */
export function nextTurnTools(prev: readonly string[], event: string, toolName?: string): string[] {
  if (event === TURN_START_EVENT) return [];
  if (event !== TOOL_START_EVENT || !toolName) return [...prev];
  const next = [...prev, toolName];
  return next.length > TURN_TOOLS_LIMIT ? next.slice(next.length - TURN_TOOLS_LIMIT) : next;
}

/** Per-session live work phase, fed by the hook route and read by the activity publisher. */
export function createWorkPhaseTracker() {
  const turnTools = new Map<string, string[]>();

  const note = (sessionId: string, event: string, toolName?: string): void => {
    turnTools.set(sessionId, nextTurnTools(turnTools.get(sessionId) ?? [], event, toolName));
  };

  // null while nothing has been observed yet (a just-started or restored session) — the phone
  // then shows the plain "working", exactly as it does today.
  const phaseOf = (sessionId: string): WorkPhase | null => classifyWorkPhase(turnTools.get(sessionId) ?? []);

  const forget = (sessionId: string): void => {
    turnTools.delete(sessionId);
  };

  return { note, phaseOf, forget };
}
