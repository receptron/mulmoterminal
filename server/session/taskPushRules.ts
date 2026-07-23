// The three decisions the phone-push body rests on, pulled out of notifyTaskFinished so the
// precedence, the suppression gate, and the location label can each be tested without a PTY,
// a config read, or a transcript on disk. All pure — the caller keeps the I/O.

import path from "node:path";

export interface PushDetailInput {
  reply: string | null;
  lastPrompt: string | undefined;
  aiTitle: string | undefined;
}

export const NO_CWD_LABEL = "session";

// A finished turn should say what the agent DID, so the reply wins; the last prompt and the AI
// title are fallbacks for when there is no reply (a blocked turn, or a read that came back
// empty). `||`, not `??`: every tier is a string that must be SKIPPED when empty — an empty
// reply means "nothing to report about the outcome", not a value to pin as the body.
export function buildPushDetail(input: PushDetailInput): string {
  return input.reply || input.lastPrompt || input.aiTitle || "";
}

// Hidden background workers and translation workers aren't real user tasks, so a turn ending
// on one must never reach the phone.
export function shouldSuppressPush(hidden: boolean, translationWorker: boolean): boolean {
  return hidden || translationWorker;
}

// Where the turn happened, for the notification: the working directory's basename, or a
// sentinel when the session was spawned without one.
export function pushWhere(cwd: string | null): string {
  return cwd ? path.basename(cwd) : NO_CWD_LABEL;
}
