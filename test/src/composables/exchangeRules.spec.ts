import { describe, it, expect } from "vitest";
import { turnAdvanced, waitVerdict, outcomeMessage } from "../../../src/composables/exchangeRules";

const turn = (prompt: string | null, reply: string | null) => ({ prompt, reply });

describe("turnAdvanced", () => {
  it("sees a new turn once the reply changes", () => {
    expect(turnAdvanced(turn("q", "old"), turn("q", "new"))).toBe(true);
  });

  it("sees a new turn once the prompt changes, even if the wording of the answer repeats", () => {
    // The text we submit becomes their next prompt, which is what makes this reliable:
    // an agent that answers "ok" twice in a row still shows a changed exchange.
    expect(turnAdvanced(turn("first", "ok"), turn("second", "ok"))).toBe(true);
  });

  it("waits while the exchange is unchanged — this is the double-send guard", () => {
    expect(turnAdvanced(turn("q", "a"), turn("q", "a"))).toBe(false);
  });

  it("waits while the terminal has recorded nothing at all", () => {
    expect(turnAdvanced(null, turn(null, null))).toBe(false);
    expect(turnAdvanced(turn("q", "a"), turn(null, null))).toBe(false);
  });

  it("counts a terminal's first ever turn as new", () => {
    expect(turnAdvanced(null, turn("q", "a"))).toBe(true);
    expect(turnAdvanced(turn(null, null), turn("q", "a"))).toBe(true);
  });

  it("sees a turn that has a reply but no recorded prompt", () => {
    expect(turnAdvanced(turn(null, null), turn(null, "a"))).toBe(true);
  });
});

describe("waitVerdict", () => {
  it("reports an answer as soon as the exchange changes", () => {
    expect(waitVerdict(turn("q", "a"), turn("q", "b"), 10, 1000)).toBe("answered");
  });

  it("keeps waiting while inside the deadline", () => {
    expect(waitVerdict(turn("q", "a"), turn("q", "a"), 999, 1000)).toBe("keep-waiting");
  });

  it("times out at the deadline", () => {
    expect(waitVerdict(turn("q", "a"), turn("q", "a"), 1000, 1000)).toBe("timed-out");
  });

  it("prefers a late answer over the timeout", () => {
    // An agent that answers exactly as the deadline lands has answered, not failed.
    expect(waitVerdict(turn("q", "a"), turn("q", "b"), 5000, 1000)).toBe("answered");
  });
});

describe("outcomeMessage", () => {
  it("says nothing when the exchange completed — the answer is the feedback", () => {
    expect(outcomeMessage("answered")).toBeNull();
  });

  it("explains every way an exchange can end early", () => {
    expect(outcomeMessage("stopped")).toBe("Stopped");
    expect(outcomeMessage("timed-out")).toContain("did not answer in time");
    expect(outcomeMessage("nothing-to-send")).toContain("No completed turn");
    expect(outcomeMessage("failed")).toContain("Could not reach");
  });
});
