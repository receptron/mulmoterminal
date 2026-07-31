// The one notification raised for a session with nothing on screen.
//
// A hidden background worker is invisible by design: no cell, no bold row, nothing waiting to be
// clicked. That is right while it works and wrong when it dies — so this is the single kind whose
// whole reason for existing is that nobody was watching.
import { describe, it, expect } from "vitest";
import { notifyKindOf, type ActivityState } from "../../../src/composables/notifyKind";

const seen = () => new Map<string, ActivityState>();

describe("notifyKindOf — worker-failed", () => {
  it("raises it with no prior state at all", () => {
    // THE case. Every other kind needs a baseline to compare against, and a worker never
    // produces one — no cell ever subscribed to it working. Requiring a baseline here would drop
    // exactly the notification that exists because nothing was watching.
    const prev = seen();
    expect(notifyKindOf(prev, { id: "w", event: "closed", failed: true })).toBe("worker-failed");
  });

  it("wins over session-exited on the SAME teardown message", () => {
    // The specific answer beats the generic one. Carried on one message precisely so the two
    // cannot race: a separate "worker-failed" push let session-exited land first and beep twice
    // for a single event (Codex, #1188).
    const prev = seen();
    notifyKindOf(prev, { id: "w", working: true, event: null });
    expect(notifyKindOf(prev, { id: "w", event: "closed", failed: true })).toBe("worker-failed");
  });

  it("forgets the session either way, so an id that comes back is a baseline", () => {
    const prev = seen();
    notifyKindOf(prev, { id: "w", working: true, event: null });
    notifyKindOf(prev, { id: "w", event: "closed", failed: true });
    expect(notifyKindOf(prev, { id: "w", event: "closed" })).toBeNull();
  });

  it("still reports an ordinary session's exit as session-exited", () => {
    // The generic path is untouched: a watched session that ends is not a failed worker.
    const prev = seen();
    notifyKindOf(prev, { id: "s", working: true, event: null });
    expect(notifyKindOf(prev, { id: "s", event: "closed" })).toBe("session-exited");
    // ...and an explicit `failed: false` is just an ordinary teardown, not a silent one.
    notifyKindOf(prev, { id: "t", working: true, event: null });
    expect(notifyKindOf(prev, { id: "t", event: "closed", failed: false })).toBe("session-exited");
  });
});
