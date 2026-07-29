import { describe, it, expect } from "vitest";
import { notifyKindOf, type ActivityState } from "../../../src/composables/notifyKind";

// Each field is spread only when given, so the fixture is the frame the server actually
// sends: an unobserved flag arrives as an ABSENT key, never as one holding undefined.
const msg = (id: string, working?: boolean, waiting?: boolean, event?: string) => ({
  id,
  ...(working === undefined ? {} : { working }),
  ...(waiting === undefined ? {} : { waiting }),
  ...(event === undefined ? {} : { event }),
});
const fresh = () => new Map<string, ActivityState>();

describe("notifyKindOf", () => {
  it("reports finished when a turn ends (working true→false)", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false)); // working baseline
    expect(notifyKindOf(prev, msg("a", false, false))).toBe("finished");
  });

  it("reports waiting when a session blocks on input", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false));
    expect(notifyKindOf(prev, msg("a", true, true, "Notification"))).toBe("waiting");
  });

  it("raises ONE finished for a background Stop, which publishes twice", () => {
    // server/session/activity-hook.ts: a Stop on a cell the user isn't looking at applies
    // { waiting: true } and then { working: false }, so two rows arrive for one finished turn.
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false, "UserPromptSubmit"));
    expect(notifyKindOf(prev, msg("a", true, true, "Stop"))).toBe("finished");
    expect(notifyKindOf(prev, msg("a", false, true, "Stop"))).toBeNull();
  });

  // The regression that made the beep intermittent: setWorking(false) publishes NOTHING when
  // `working` was already false, so a turn whose working flag was never set produces only the
  // waiting row. Keying "finished" on the working flag dropping made exactly those turns silent.
  it("still raises finished when the working flag was never set", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", false, false)); // idle baseline — no working flag
    expect(notifyKindOf(prev, msg("a", false, true, "Stop"))).toBe("finished");
  });

  it("raises finished for a Stop on the pane the user is watching (one row, no waiting)", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false, "UserPromptSubmit"));
    expect(notifyKindOf(prev, msg("a", false, false, "Stop"))).toBe("finished");
  });

  // A Stop is a finished turn even though it raises the same flag a prompt does — calling it
  // "waiting" would play the wrong sound and, with soundKinds, the wrong switch would mute it.
  it("never reports a Stop as waiting", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false));
    expect(notifyKindOf(prev, msg("a", true, true, "Stop"))).not.toBe("waiting");
  });

  it("reports session-exited on a close, and only for a session it had seen", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false));
    expect(notifyKindOf(prev, { id: "a", working: false, event: "closed" })).toBe("session-exited");
    // Forgotten now, so a duplicate close is not a second notification.
    expect(notifyKindOf(prev, { id: "a", working: false, event: "closed" })).toBeNull();
    expect(notifyKindOf(fresh(), { id: "never-seen", event: "closed" })).toBeNull();
  });

  it("is baseline-only on first sight", () => {
    expect(notifyKindOf(fresh(), msg("a", false, true, "Notification"))).toBeNull();
    expect(notifyKindOf(fresh(), msg("a", true, false))).toBeNull();
  });

  it("stays silent while nothing moves", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false));
    expect(notifyKindOf(prev, msg("a", true, false))).toBeNull();
  });

  it("stays silent when work STARTS", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", false, false));
    expect(notifyKindOf(prev, msg("a", true, false))).toBeNull();
  });

  it("does not repeat waiting while it stays waiting", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false));
    expect(notifyKindOf(prev, msg("a", true, true, "Notification"))).toBe("waiting");
    expect(notifyKindOf(prev, msg("a", true, true, "Notification"))).toBeNull();
  });

  it("treats missing fields as not-working / not-waiting", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true));
    expect(notifyKindOf(prev, { id: "a" })).toBe("finished");
  });

  it("tracks sessions independently", () => {
    const prev = fresh();
    notifyKindOf(prev, msg("a", true, false));
    notifyKindOf(prev, msg("b", true, false));
    expect(notifyKindOf(prev, msg("b", false, false))).toBe("finished");
    expect(notifyKindOf(prev, msg("a", true, false))).toBeNull();
  });
});
