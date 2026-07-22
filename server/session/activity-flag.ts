// What setting a session's working/waiting flag should DO, separated from doing it.
//
// setWorking and setWaiting were the same twelve lines with one word changed — jscpd flagged
// the duplication, and the duplication hid the one real difference: which edge re-arms the
// reap. A session that stops WORKING might have stopped to ask the user something, so it must
// not be killed before they answer; a session that starts WAITING has just escalated from the
// short idle grace to the long one. Both re-arm, but on opposite edges, and writing them
// twice is how those two conditions drift.
//
// This decides; the caller applies. `changed` is null when the flag's value did not actually
// move — every hook calls these, and publishing an unchanged row would flood the socket.
import type { Activity } from "./types.js";
import { nextActivity } from "./activity-transition.js";

export type ActivityFlag = "working" | "waiting";

export interface FlagEffect {
  // The activity record to store and publish. Null means nothing changed — do nothing.
  next: Activity | null;
  // Whether the detached-reap should be re-armed for this session after publishing.
  rearmReap: boolean;
}

// working: re-arm when it goes FALSE (a finished turn might be waiting on the user).
// waiting: re-arm when it goes TRUE (needing the user escalates to the long grace).
export function flagEffect(prev: Activity | undefined, flag: ActivityFlag, value: boolean, event: string | undefined, now: number): FlagEffect {
  const next = nextActivity(prev, flag === "working" ? { working: value } : { waiting: value }, event, now);
  if (!next) return { next: null, rearmReap: false };
  const rearmReap = flag === "working" ? !value : value;
  return { next, rearmReap };
}
