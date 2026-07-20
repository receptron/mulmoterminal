// Pure decision for a Claude activity hook (UserPromptSubmit / Stop / Notification).
//
// `active` = this session is the user's actively-viewed pane: the single-view open
// session, or a focused/zoomed grid cell. An active pane never raises the attention
// flag (the user is already looking at it). A grid cell the user is NOT focused on is
// inactive even though its socket is attached, so it can surface `blocked` (Notification)
// or `done` (Stop) among its siblings — the whole point of the parallel grid.
//
// Extracted from index.ts so the grid attention semantics are unit-testable; the
// caller applies the effects via setWorking/setWaiting (which publish + arm reaps).

export type ActivityEffect = { kind: "working" | "waiting"; value: boolean };

export function activityHookEffects(event: string, active: boolean): ActivityEffect[] {
  if (event === "UserPromptSubmit") return [{ kind: "working", value: true }];
  // A finished turn (Stop) has unseen output; a paused turn (Notification) waits on the
  // user. Either flags the session for attention UNLESS it's the actively-viewed pane.
  if (event === "Stop") {
    return active
      ? [{ kind: "working", value: false }]
      : [
          { kind: "waiting", value: true },
          { kind: "working", value: false },
        ];
  }
  if (event === "Notification") return active ? [] : [{ kind: "waiting", value: true }];
  return [];
}

// Whether a finished turn should fire a task-finished Web Push. Unlike the attention beep
// (activityHookEffects, which stays quiet on the actively-viewed pane), the push fires for
// EVERY finished turn regardless of `active` — the user wants a phone notification even for
// the session they're currently looking at. The pushEnabled / hidden / translation gates
// are applied by the caller.
export function shouldNotifyTaskFinished(event: string): boolean {
  return event === "Stop";
}

// Which session a hook belongs to, or null when neither source names one usably.
//
// The `x-mt-session` header wins: Claude reissues its own session_id on /clear and
// /compact, while the mulmoterminal id is the one hooks must stay attributed to.
//
// BOTH sources are validated against the same UUID shape. The id does not stay inside
// this process — it becomes a Firestore document id (backends/remoteHost/sessionActivity)
// and travels to the phone as push routing, where a value containing "/" would change
// the document path rather than address a session. The rest of the codebase already
// treats a SESSION_ID_RE match as the precondition for using an id as a filename, so
// the fallback has no business being the one place that skips it.
export function resolveHookSessionId(header: unknown, bodyValue: unknown, isValidId: (id: string) => boolean): string | null {
  const usable = (value: unknown): string | null => (typeof value === "string" && isValidId(value) ? value : null);
  return usable(header) ?? usable(bodyValue);
}
