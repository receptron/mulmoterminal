import { describe, it, expect } from "vitest";
import { reapDecisionFor, reapTimerDelay, parseWaitGraceMs, MAX_TIMER_MS } from "../../../server/session/reap-policy.js";

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

// The grace a decision produces still has to survive setTimeout. Node's delay is a signed
// 32-bit int: a larger value overflows and fires at ~1ms, so an unclamped 30-minute grace
// would reap the session almost immediately — the opposite of what it asks for.
describe("reapTimerDelay", () => {
  it("passes an ordinary grace through unchanged", () => {
    expect(reapTimerDelay(30_000)).toBe(30_000);
    expect(reapTimerDelay(30 * 60_000)).toBe(1_800_000);
  });

  it("clamps a grace past the 32-bit timer limit instead of letting it overflow", () => {
    expect(reapTimerDelay(2_147_483_648)).toBe(2_147_483_647);
    expect(reapTimerDelay(1e12)).toBe(2_147_483_647);
  });

  it("pins the limit to the actual 32-bit maximum", () => {
    // Spelled out rather than compared against the constant, so shifting the constant
    // is a failure instead of something the test quietly follows.
    expect(MAX_TIMER_MS).toBe(2_147_483_647);
    expect(reapTimerDelay(2_147_483_647)).toBe(2_147_483_647);
    expect(reapTimerDelay(2_147_483_646)).toBe(2_147_483_646);
    expect(reapTimerDelay(2_147_483_648)).toBe(2_147_483_647);
  });

  it("means never for a non-positive grace, which is how auto-reaping is switched off", () => {
    expect(reapTimerDelay(0)).toBeNull();
    expect(reapTimerDelay(-1)).toBeNull();
    expect(reapTimerDelay(-Infinity)).toBeNull();
  });

  it("means never for a non-finite grace rather than firing immediately", () => {
    // setTimeout(..., NaN) fires on the next tick — a bad config must not reap instantly.
    expect(reapTimerDelay(NaN)).toBeNull();
    expect(reapTimerDelay(Infinity)).toBeNull();
  });

  it("keeps a sub-millisecond grace rather than rounding it away", () => {
    expect(reapTimerDelay(0.5)).toBe(0.5);
  });
});

// WAIT_REAP_GRACE_MS decides how long a session that needs the user survives once
// detached. Misreading it either closes an unfinished task early or never closes it.
describe("parseWaitGraceMs", () => {
  const DEFAULT_MS = 30 * 60_000;

  it("uses the default when the variable is unset", () => {
    expect(parseWaitGraceMs(undefined, DEFAULT_MS)).toBe(DEFAULT_MS);
  });

  it("reads a numeric value", () => {
    expect(parseWaitGraceMs("60000", DEFAULT_MS)).toBe(60_000);
    expect(parseWaitGraceMs(" 60000 ", DEFAULT_MS)).toBe(60_000); // Number() trims
  });

  it("keeps a non-positive value, which switches auto-reaping off", () => {
    expect(parseWaitGraceMs("0", DEFAULT_MS)).toBe(0);
    expect(parseWaitGraceMs("-1", DEFAULT_MS)).toBe(-1);
  });

  it("treats an empty or blank value as 0 — never auto-reap — not as unset", () => {
    // Number("") is 0, so this is a real behavioural distinction from `undefined`.
    expect(parseWaitGraceMs("", DEFAULT_MS)).toBe(0);
    expect(parseWaitGraceMs("   ", DEFAULT_MS)).toBe(0);
  });

  it("falls back to the default for a value that is not a number", () => {
    // Falling back matters: a typo must not silently disable reaping.
    expect(parseWaitGraceMs("abc", DEFAULT_MS)).toBe(DEFAULT_MS);
    expect(parseWaitGraceMs("NaN", DEFAULT_MS)).toBe(DEFAULT_MS);
    expect(parseWaitGraceMs("30m", DEFAULT_MS)).toBe(DEFAULT_MS);
  });

  it("falls back for an infinite value, which no timer could honour", () => {
    expect(parseWaitGraceMs("Infinity", DEFAULT_MS)).toBe(DEFAULT_MS);
    expect(parseWaitGraceMs("1e400", DEFAULT_MS)).toBe(DEFAULT_MS); // overflows to Infinity
  });

  it("reports the raw value it rejected, and only then", () => {
    const rejected: string[] = [];
    const onInvalid = (raw: string) => rejected.push(raw);
    parseWaitGraceMs("abc", DEFAULT_MS, onInvalid);
    parseWaitGraceMs("60000", DEFAULT_MS, onInvalid);
    parseWaitGraceMs(undefined, DEFAULT_MS, onInvalid);
    parseWaitGraceMs("0", DEFAULT_MS, onInvalid);
    expect(rejected).toEqual(["abc"]);
  });

  it("feeds reapTimerDelay: a rejected value still yields a real timer", () => {
    // The two compose — a bad env var must land on the default grace, not on "never".
    expect(reapTimerDelay(parseWaitGraceMs("abc", DEFAULT_MS))).toBe(DEFAULT_MS);
    expect(reapTimerDelay(parseWaitGraceMs("0", DEFAULT_MS))).toBeNull();
  });
});
