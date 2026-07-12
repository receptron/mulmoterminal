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
