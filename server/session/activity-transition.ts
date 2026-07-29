// Pure derivations from a session's activity record: what a flag change makes it, and what
// the row published to subscribers looks like. The decisions only — no publish, no
// persistence, no reap. Split from index.ts (#548 step 3h):
// setWorking and setWaiting differed by one field but each re-derived the same rules, and
// both are load-bearing. The "unchanged" answer is what keeps an idle session from
// republishing on every hook, and the event fallback is what keeps a row labelled with the
// event that last meant something rather than blanking it.
import type { Activity } from "./types.js";

/** The record to store, or null when nothing changed and the caller should do nothing.
 *  `event` falls back to the previous one so a change that carries no event keeps the
 *  label the row already had; only an explicit null clears it (via a first-ever write). */
export function nextActivity(
  prev: Activity | undefined,
  patch: { working: boolean } | { waiting: boolean },
  event: string | undefined,
  now: number,
): Activity | null {
  const current = prev ?? {};
  const key = "working" in patch ? "working" : "waiting";
  const value = "working" in patch ? patch.working : patch.waiting;
  if ((current[key] ?? false) === value) return null;
  return { ...current, [key]: value, event: event ?? current.event ?? null, at: now };
}

/** The session row published to subscribers. Every field is defaulted here rather than at
 *  the receiving end, so a session with no activity yet still reads as idle instead of
 *  arriving with holes. */
export interface SessionRow {
  id: string;
  cwd: string | null;
  working: boolean;
  waiting: boolean;
  event: string | null;
  lastPrompt: string | null;
  aiTitle: string | null;
  lastResponse: string | null;
  memo: string | null;
}

export function sessionRow(
  id: string,
  activity: Activity | undefined,
  cwd: string | null,
  texts: { lastPrompt?: string | undefined; aiTitle?: string | undefined; lastResponse?: string | undefined; memo?: string | undefined },
): SessionRow {
  const a = activity ?? {};
  return {
    id,
    cwd,
    working: a.working ?? false,
    waiting: a.waiting ?? false,
    event: a.event ?? null,
    lastPrompt: texts.lastPrompt ?? null,
    aiTitle: texts.aiTitle ?? null,
    lastResponse: texts.lastResponse ?? null,
    // Null is "this session has no memo", which is exactly what an erase should publish: the
    // receiving header falls back to the AI title on it.
    memo: texts.memo ?? null,
  };
}

/** Whether to re-read the transcript's tail before publishing. `waiting` means a turn just
 *  ended, which is the moment the roster's copy of the reply goes stale; without a cwd
 *  there is no transcript to read. `transcriptCleared` is the third: after a `/clear` our file
 *  holds the ended conversation, so re-reading it is how the pre-clear reply came back (#1085). */
export function shouldRefreshReply(activity: Activity | undefined, cwd: string | null, transcriptCleared: boolean): cwd is string {
  return !!(activity?.waiting && cwd && !transcriptCleared);
}
