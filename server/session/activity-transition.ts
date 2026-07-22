// What a working/waiting flag change does to a session's activity record — the decision
// only, with no publish, no persistence and no reap. Split from index.ts (#548 step 3h):
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
