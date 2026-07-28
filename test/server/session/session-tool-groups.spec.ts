import { describe, it, expect } from "vitest";

import { parseSessionToolGroups, sessionToolGroupLine, TOOL_GROUP_RESET } from "../../../server/session/session-tool-groups.js";

const ID = "11111111-1111-1111-1111-111111111111";
const ID2 = "22222222-2222-2222-2222-222222222222";
const isValidId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

describe("parseSessionToolGroups", () => {
  it("reads one entry per line", () => {
    expect(parseSessionToolGroups(`${ID} render\n${ID} data\n${ID2} media`, isValidId)).toEqual([
      { sessionId: ID, group: "render" },
      { sessionId: ID, group: "data" },
      { sessionId: ID2, group: "media" },
    ]);
  });

  // The log is appended to on every learn, and the same pair is learned again after a restart.
  it("collapses a repeated pair", () => {
    expect(parseSessionToolGroups(`${ID} render\n${ID} render`, isValidId)).toEqual([{ sessionId: ID, group: "render" }]);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    expect(parseSessionToolGroups(`\n  ${ID}   render  \n\n`, isValidId)).toEqual([{ sessionId: ID, group: "render" }]);
  });

  // A bad id would be compared against real ones; a bad group against a real URL. Neither is
  // worth guessing at, and a torn append is the ordinary way to get one.
  it("drops an unusable session id", () => {
    expect(parseSessionToolGroups(`not-an-id render\n${ID} render`, isValidId)).toEqual([{ sessionId: ID, group: "render" }]);
  });

  it("drops an unknown group", () => {
    expect(parseSessionToolGroups(`${ID} everything\n${ID} data`, isValidId)).toEqual([{ sessionId: ID, group: "data" }]);
  });

  it("drops a line carrying more than the two fields", () => {
    expect(parseSessionToolGroups(`${ID} render extra`, isValidId)).toEqual([]);
  });

  it("reads an empty file as nothing", () => {
    expect(parseSessionToolGroups("", isValidId)).toEqual([]);
  });
});

describe("sessionToolGroupLine", () => {
  // Leading newline, like dev-terminal-sessions.ts: whatever the file ended with — including a
  // write cut off mid-line — an appended entry starts its own line, so the damage is one entry.
  it("leads with the newline so an append always starts its own line", () => {
    expect(sessionToolGroupLine(ID, "render")).toBe(`\n${ID} render`);
  });

  it("round-trips through the parser", () => {
    const file = sessionToolGroupLine(ID, "render") + sessionToolGroupLine(ID2, "external");
    expect(parseSessionToolGroups(file, isValidId)).toEqual([
      { sessionId: ID, group: "render" },
      { sessionId: ID2, group: "external" },
    ]);
  });

  // A file written by the previous version of this log, or a torn last line, must not take the
  // earlier entries with it.
  it("keeps earlier entries when the last line is truncated", () => {
    const file = `${sessionToolGroupLine(ID, "render")}\n${ID2} ren`;
    expect(parseSessionToolGroups(file, isValidId)).toEqual([{ sessionId: ID, group: "render" }]);
  });
});

// What a session HAS is decided by the claude process currently running for it, and that is
// replaced on every restart/resume — with whatever the user's MCP config says at that moment.
// Without a reset, disabling Canvas and restarting the same id would leave the old capability
// asserted for the life of the log.
describe("the reset marker", () => {
  it("drops what the session learned before it", () => {
    expect(parseSessionToolGroups(`${ID} render\n${ID} data\n${ID} -`, isValidId)).toEqual([]);
  });

  it("keeps what the session learns after it", () => {
    expect(parseSessionToolGroups(`${ID} render\n${ID} -\n${ID} data`, isValidId)).toEqual([{ sessionId: ID, group: "data" }]);
  });

  // The log is shared, so one session's restart must not disturb another's.
  it("resets only the session it names", () => {
    expect(parseSessionToolGroups(`${ID} render\n${ID2} render\n${ID} -`, isValidId)).toEqual([{ sessionId: ID2, group: "render" }]);
  });

  it("is written by the same line builder", () => {
    expect(sessionToolGroupLine(ID, TOOL_GROUP_RESET)).toBe(`\n${ID} -`);
  });

  // Replay ORDER is what makes a reset mean anything — a set union of the file would not.
  it("survives a round trip through the builder", () => {
    const file = sessionToolGroupLine(ID, "render") + sessionToolGroupLine(ID, TOOL_GROUP_RESET) + sessionToolGroupLine(ID, "media");
    expect(parseSessionToolGroups(file, isValidId)).toEqual([{ sessionId: ID, group: "media" }]);
  });
});
