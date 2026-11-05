import { describe, it, expect } from "vitest";
import { canStartTalk } from "../../../src/components/cellTalkStart";

const ID = "11111111-1111-1111-1111-111111111111";

describe("canStartTalk", () => {
  it("starts from a cell whose session is running", () => {
    expect(canStartTalk({ sessionId: ID, sessionEnded: false })).toBe(true);
  });

  it.each([
    { name: "the session ended but the cell stayed", sessionId: ID, sessionEnded: true },
    { name: "no session yet", sessionId: null, sessionEnded: false },
    { name: "an empty id", sessionId: "", sessionEnded: false },
    { name: "no session and ended", sessionId: null, sessionEnded: true },
  ])("refuses when $name", ({ sessionId, sessionEnded }) => {
    expect(canStartTalk({ sessionId, sessionEnded })).toBe(false);
  });
});
