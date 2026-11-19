// @vitest-environment node
import { describe, it, expect } from "vitest";
import { currentTranscriptId } from "../../../../server/session/transcript/current-transcript.js";

const OWN = "11111111-2222-4333-8444-555555555555";
const SUCCESSOR = "22222222-3333-4444-8555-666666666666";

describe("currentTranscriptId", () => {
  it("reads the session's own transcript when it never moved", () => {
    expect(currentTranscriptId(OWN, { cleared: false, successor: undefined })).toBe(OWN);
  });

  // A successor without the mark is stale memory, not a move.
  it("ignores a successor when the session is not marked", () => {
    expect(currentTranscriptId(OWN, { cleared: false, successor: SUCCESSOR })).toBe(OWN);
  });

  it("reads the successor of a session that moved", () => {
    expect(currentTranscriptId(OWN, { cleared: true, successor: SUCCESSOR })).toBe(SUCCESSOR);
  });

  // Never the frozen file: a move with nowhere recorded reads as nothing.
  it.each([[undefined], [""]])("reads nothing for a moved session with successor %j", (successor) => {
    expect(currentTranscriptId(OWN, { cleared: true, successor })).toBeNull();
  });
});
