import { isRecord } from "./isRecord.js";

// The pub/sub channel carrying "the user just submitted a prompt to this session". Both sides
// decide from it — the server publishes on the hook, the prompts pane listens to know its list
// grew — so the name and the payload shape live here rather than as a string literal on each side.
//
// A channel of its own rather than the `sessions` activity row, which is what a reader would reach
// for first and which cannot answer this: an activity publish is suppressed when the flag does not
// MOVE (nextActivity returns null, deliberately, so an unchanged row cannot flood the socket). A
// prompt sent while the agent is already working leaves `working` true either way, so it publishes
// nothing — and that prompt, the one interrupting a running turn, is exactly the one the pane
// exists to show (#1748, found by Codex on #1749).
export const PROMPT_SUBMITTED_CHANNEL = "prompt-submitted";

/** The session the prompt was typed at — our id, the one a cell holds. */
export interface PromptSubmittedEvent {
  sessionId: string;
}

/** Both sides go through this rather than re-spelling the payload: the publisher pins it with
 *  `satisfies`, the subscriber narrows an untyped pub/sub frame with it. */
export const isPromptSubmittedEvent = (data: unknown): data is PromptSubmittedEvent => isRecord(data) && typeof data.sessionId === "string";
