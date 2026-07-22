import { describe, it, expect } from "vitest";
import { reapDecisionFor } from "../../../server/session/reap-policy.js";

const graces = { idleMs: 30_000, waitingMs: 1_800_000 };

describe("reapDecisionFor", () => {
  it("arms the short grace for an idle session", () => {
    expect(reapDecisionFor({ working: false, waiting: false }, graces)).toEqual({ kind: "arm", delayMs: 30_000 });
  });

  it("arms the long grace for one that needs the user", () => {
    expect(reapDecisionFor({ waiting: true }, graces)).toEqual({ kind: "arm", delayMs: 1_800_000 });
  });

  it("keeps a session that is still working", () => {
    expect(reapDecisionFor({ working: true }, graces)).toEqual({ kind: "keep" });
  });

  // #541: Notification never clears `working`, so a background session blocked on a
  // permission prompt sits at working+waiting forever — it must still get the long grace.
  it("arms the long grace when a working session is blocked on the user", () => {
    expect(reapDecisionFor({ working: true, waiting: true }, graces)).toEqual({ kind: "arm", delayMs: 1_800_000 });
  });

  it("treats a session with no activity record as idle", () => {
    expect(reapDecisionFor(undefined, graces)).toEqual({ kind: "arm", delayMs: 30_000 });
  });

  it("treats an empty activity record as idle", () => {
    expect(reapDecisionFor({}, graces)).toEqual({ kind: "arm", delayMs: 30_000 });
  });

  // A non-positive grace means "never auto-reap" — scheduleReap drops it, so the
  // decision just passes the value through rather than second-guessing it.
  it("passes a disabled (zero) waiting grace straight through", () => {
    expect(reapDecisionFor({ waiting: true }, { idleMs: 30_000, waitingMs: 0 })).toEqual({ kind: "arm", delayMs: 0 });
  });
});
