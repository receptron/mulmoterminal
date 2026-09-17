// @vitest-environment node
//
// The budgets a headless run is allowed to spend, checked WITHOUT a browser.
//
// The contract test next door drives real Chrome and is skipped where none is installed — which is
// most review hosts and every CI job here. These numbers are what decides how long a user waits for
// an answer, so they are pinned somewhere that always runs.
import { describe, it, expect } from "vitest";
import { LIMITS, roomForAnotherHarnessAttempt } from "../../../server/backends/sharedApp/headlessPreview.js";

/** What Puppeteer uses when a navigation is given no timeout. Named here because it is the number
 *  the harness navigation used to inherit, not because anything should depend on it. */
const PUPPETEER_DEFAULT_NAVIGATION_MS = 30_000;

describe("LIMITS", () => {
  it("gives every wait a real duration", () => {
    for (const key of ["harnessMs", "navigateMs", "retryPauseMs", "evaluateMs", "readyMs", "settleMs"] as const) {
      expect(Number.isFinite(LIMITS[key]) && LIMITS[key] > 0, `${key} is not a duration: ${LIMITS[key]}`).toBe(true);
    }
  });

  it("keeps the harness navigation inside a budget of its own, not Puppeteer's default", () => {
    // The point of #2103: that one call inherited a number six times the budget the wait on the
    // line after it gets.
    expect(LIMITS.navigateMs).toBeLessThan(PUPPETEER_DEFAULT_NAVIGATION_MS);
  });

  // The first version of this asserted `harnessAttempts * navigateMs`, which is the NAVIGATION
  // total and not what a caller waits for: an attempt is also the wait for the harness to appear
  // and the pause before the next one, so three of them reach ~45s while that assertion reads 30s
  // and passes (CodeRabbit on #2104). The bound is now enforced by the loop, and these pin the
  // rule the loop uses rather than an arithmetic identity about one phase.
  it("lets an attempt start only when the WHOLE of it fits in what is left", () => {
    const attemptWorstMs = LIMITS.navigateMs + LIMITS.evaluateMs + LIMITS.retryPauseMs;
    expect(roomForAnotherHarnessAttempt(0)).toBe(true);
    expect(roomForAnotherHarnessAttempt(LIMITS.harnessMs - attemptWorstMs)).toBe(true);
    // One millisecond past the point where a full attempt fits, and the answer flips.
    expect(roomForAnotherHarnessAttempt(LIMITS.harnessMs - attemptWorstMs + 1)).toBe(false);
    expect(roomForAnotherHarnessAttempt(LIMITS.harnessMs)).toBe(false);
  });

  it("keeps the whole retry loop inside the budget a caller is told about", () => {
    // What the loop can actually spend: it starts an attempt only while one fits, so the total
    // cannot pass harnessMs. Stated as the property rather than as a product, because the product
    // is what was wrong.
    const attemptWorstMs = LIMITS.navigateMs + LIMITS.evaluateMs + LIMITS.retryPauseMs;
    expect(attemptWorstMs).toBeLessThanOrEqual(LIMITS.harnessMs);
    expect(LIMITS.harnessMs).toBeLessThanOrEqual(LIMITS.harnessAttempts * PUPPETEER_DEFAULT_NAVIGATION_MS);
  });

  it("does not starve the navigation relative to what it waits for next", () => {
    // Too small is the other failure, and this repo has paid for it once upstream: the navigation
    // is a page load, the wait after it is one function appearing, and a page load is the larger
    // of the two.
    expect(LIMITS.navigateMs).toBeGreaterThan(LIMITS.evaluateMs);
  });
});
