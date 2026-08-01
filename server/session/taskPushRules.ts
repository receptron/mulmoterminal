// The three decisions the phone-push body rests on, pulled out of notifyTaskFinished so the
// precedence, the suppression gate, and the location label can each be tested without a PTY,
// a config read, or a transcript on disk. All pure — the caller keeps the I/O.

import path from "node:path";
import type { PushKind } from "../../common/pushKinds.js";

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

// Background workers and translation workers aren't real user tasks, so a turn ending on one
// must never reach the phone. "never" is why the caller answers `background` from the durable
// marking rather than from which sessions this process happens to have spawned.
//
// A user's SCHEDULED task is the exception, and it is the reason this takes three answers rather
// than two. It is a background session in every other respect — out of the chat list, never bold,
// no grid cell — but it is a task the user configured, running while they are away, and the phone
// is the only way they would ever hear about it. Suppressing it would silence exactly the case the
// setting exists for (Codex, PR #1196).
//
// A translation worker is still refused even if something ever schedules one: it is an internal
// helper with no output a person reads, so there is nothing to tell them about.
export function shouldSuppressPush(background: boolean, translationWorker: boolean, userScheduled = false): boolean {
  if (translationWorker) return true;
  return background && !userScheduled;
}

// Whether the user asked to hear about THIS moment (#850). Two independent answers: the master
// switch says whether to notify at all, and the kind list says which moments qualify — so
// silencing the pushes a blocked agent raises never costs the finished-turn ones.
export function wantsPushKind(enabled: boolean, wanted: readonly PushKind[], kind: PushKind): boolean {
  return enabled && wanted.includes(kind);
}

// Where the turn happened, for the notification: the working directory's basename, or a
// sentinel when the session was spawned without one.
export function pushWhere(cwd: string | null): string {
  return cwd ? path.basename(cwd) : NO_CWD_LABEL;
}
