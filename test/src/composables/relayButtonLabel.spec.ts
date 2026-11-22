import { describe, it, expect } from "vitest";
import { partnerShortName, relayButtonLabel } from "../../../src/composables/relayButtonLabel";
import { someoneElsewhere } from "../../../src/composables/useRelayButton";
import type { SlotInfo } from "../../../src/composables/readableSlot";

const slot = (key: string, agent: SlotInfo["agent"] = "codex", cwd: string | null = "/r"): SlotInfo => ({ key, sessionId: `s-${key}`, agent, cwd });

describe("relayButtonLabel", () => {
  it("is null with no partner, so the button is not drawn", () => {
    expect(relayButtonLabel([])).toBeNull();
  });

  it("names the one partner", () => {
    expect(relayButtonLabel([slot("cell-4")])).toEqual({ kind: "one", name: "codex #4" });
  });

  it("counts several", () => {
    expect(relayButtonLabel([slot("cell-4"), slot("cell-7", "claude")])).toEqual({ kind: "many", count: 2 });
  });
});

describe("partnerShortName", () => {
  it.each([
    ["cell-4", "codex", "codex #4"],
    ["cell-12", "claude", "claude #12"],
    ["single", "cursor", "cursor"],
  ] as const)("%s running %s → %s", (key, agent, expected) => expect(partnerShortName(slot(key, agent))).toBe(expected));
});

describe("someoneElsewhere", () => {
  it("is true only for another terminal in a different, known directory", () => {
    expect(someoneElsewhere([slot("cell-1"), slot("cell-2")], "cell-1", "/r")).toBe(false);
    expect(someoneElsewhere([slot("cell-1"), slot("cell-2", "codex", "/r-wt")], "cell-1", "/r")).toBe(true);
    expect(someoneElsewhere([slot("cell-1", "codex", "/elsewhere")], "cell-1", "/r")).toBe(false);
    expect(someoneElsewhere([slot("cell-1"), slot("cell-2", "codex", null)], "cell-1", "/r")).toBe(false);
    expect(someoneElsewhere([slot("cell-1"), slot("cell-2", "codex", "/r-wt")], "cell-1", null)).toBe(false);
  });
});
